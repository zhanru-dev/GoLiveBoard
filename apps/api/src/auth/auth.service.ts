import { Inject, Injectable } from "@nestjs/common";
import type { SignInRequest, SignUpRequest } from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { Mailer, type MailMessage } from "../mail/mailer.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { type AccessTokenKeys, signAccessToken } from "./access-token.js";
import { REFRESH_TOKEN_TTL_MS, type SessionTokens } from "./cookies.js";
import { accountExistsEmail, welcomeEmail } from "./emails.js";
import { PasswordHasher } from "./password-hasher.js";
import { generateToken, hashToken } from "./tokens.js";

/**
 * A browser that sends two requests at once with the same refresh cookie
 * (two tabs, a retried request) presents the old token a moment after the
 * other request rotated it. That is not theft, so within this window the
 * session survives; after it, reuse means a copied token and the session is
 * revoked (ADR-0005).
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * What a refresh produced. `superseded` means the token was rotated by a
 * concurrent request moments ago: the session is fine and the browser already
 * holds (or is about to receive) the new cookies, so nothing must be changed.
 */
export type RefreshResult =
  | { readonly kind: "rotated"; readonly tokens: SessionTokens }
  | { readonly kind: "superseded" };

const UNIQUE_VIOLATION = "P2002";

@Injectable()
export class AuthService {
  private readonly tokenKeys: AccessTokenKeys;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
    private readonly rateLimiter: RateLimiter,
    private readonly passwords: PasswordHasher,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {
    this.tokenKeys = {
      current: config.auth.jwtSecret,
      previous: config.auth.jwtPreviousSecret,
    };
  }

  /**
   * Creates a user, a workspace and an Owner membership (FR-WS-1). Behaves
   * identically, including timing, when the email is already registered: that
   * case only sends the owner of the address an email.
   */
  async signUp(input: SignUpRequest, ip: string): Promise<void> {
    await this.rateLimiter.consumeOrThrow(RATE_LIMITS.signUpPerIp, ip);
    // Hash first and always, so both outcomes take the same time.
    const passwordHash = await this.passwords.hash(input.password);
    const origin = this.config.app.origin;
    try {
      await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          memberships: {
            create: {
              role: "OWNER",
              workspace: { create: { name: `${input.name}'s workspace` } },
            },
          },
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      this.sendInBackground(accountExistsEmail(input.email, origin));
      return;
    }
    this.sendInBackground(welcomeEmail(input.email, input.name, origin));
  }

  /**
   * Starts a session in the user's first workspace. A wrong password, an
   * unknown email and a disabled account all fail the same way (FR-AUTH-1).
   */
  async signIn(input: SignInRequest, ip: string): Promise<SessionTokens> {
    // Brute-force protection, per account and per address. Every attempt
    // takes a slot before the password is checked, so a burst of concurrent
    // guesses cannot all slip past the limit; a successful sign-in gives its
    // slot back, so only failures count against the limit.
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.signInFailuresPerAccount,
      input.email,
    );
    await this.rateLimiter.consumeOrThrow(RATE_LIMITS.signInFailuresPerIp, ip);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    const passwordMatches =
      user === null
        ? await this.passwords.verifyAgainstDummy(input.password)
        : await this.passwords.verify(user.passwordHash, input.password);
    if (user === null || !passwordMatches || user.disabledAt !== null) {
      throw new DomainError("CREDENTIALS_INVALID");
    }
    const [membership] = user.memberships;
    if (membership === undefined) {
      throw new DomainError("FORBIDDEN", {
        detail: "You are not a member of any workspace.",
      });
    }
    const tokens = await this.startSession(
      user.id,
      membership.workspaceId,
      user.passwordHash,
    );
    await this.rateLimiter.reset(
      RATE_LIMITS.signInFailuresPerAccount,
      input.email,
    );
    await this.rateLimiter.refund(RATE_LIMITS.signInFailuresPerIp, ip);
    return tokens;
  }

  /**
   * Exchanges a refresh token for a new pair. The old token stops working in
   * the same statement that issues the new one, so of two concurrent requests
   * with the same token exactly one succeeds (FR-AUTH-2).
   */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const now = this.clock.now();
    const presentedHash = hashToken(refreshToken);
    const nextToken = generateToken();
    const nextHash = hashToken(nextToken);

    const { count } = await this.prisma.session.updateMany({
      where: {
        refreshTokenHash: presentedHash,
        revokedAt: null,
        refreshExpiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: nextHash,
        previousRefreshTokenHash: presentedHash,
        rotatedAt: now,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      },
    });
    if (count === 0) {
      if (await this.isRecentlyRotated(presentedHash, now)) {
        return { kind: "superseded" };
      }
      throw new DomainError("UNAUTHENTICATED");
    }
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: nextHash },
      select: { id: true },
    });
    return {
      kind: "rotated",
      tokens: {
        accessToken: await signAccessToken(session.id, this.tokenKeys, now),
        refreshToken: nextToken,
      },
    };
  }

  /** Revokes the session the refresh token belongs to (FR-AUTH-3). */
  async signOut(refreshToken: string): Promise<void> {
    const presentedHash = hashToken(refreshToken);
    await this.prisma.session.updateMany({
      where: {
        OR: [
          { refreshTokenHash: presentedHash },
          { previousRefreshTokenHash: presentedHash },
        ],
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  /**
   * Creates the session only if the credentials that were just checked are
   * still the user's. A password reset that commits while the password is
   * being verified would otherwise be followed by a session it never saw.
   *
   * `FOR SHARE` makes the two serialise: sign-ins do not block each other,
   * but a reset's `UPDATE users` waits for this transaction, and the reset's
   * next statement, which revokes the user's sessions, then sees this one.
   * If the reset committed first, the hash no longer matches and the
   * sign-in fails like a wrong password.
   */
  private async startSession(
    userId: string,
    workspaceId: string,
    verifiedPasswordHash: string,
  ): Promise<SessionTokens> {
    const now = this.clock.now();
    const refreshToken = generateToken();
    const session = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<
        { password_hash: string; disabled_at: Date | null }[]
      >`
        SELECT password_hash, disabled_at FROM users
        WHERE id = ${userId}::uuid
        FOR SHARE`;
      if (
        current?.password_hash !== verifiedPasswordHash ||
        current.disabled_at !== null
      ) {
        throw new DomainError("CREDENTIALS_INVALID");
      }
      return tx.session.create({
        data: {
          userId,
          activeWorkspaceId: workspaceId,
          refreshTokenHash: hashToken(refreshToken),
          refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
        select: { id: true },
      });
    });
    return {
      accessToken: await signAccessToken(session.id, this.tokenKeys, now),
      refreshToken,
    };
  }

  /**
   * A token that was rotated away came back. Within the grace window that is
   * a concurrent request from the same browser (true). After it, someone may
   * have a copy of the token, so the session is revoked (false).
   */
  private async isRecentlyRotated(
    presentedHash: string,
    now: Date,
  ): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { previousRefreshTokenHash: presentedHash },
      select: { id: true, rotatedAt: true, revokedAt: true },
    });
    if (session === null) {
      return false;
    }
    if (session.revokedAt !== null) {
      return false;
    }
    const rotatedAgoMs =
      now.getTime() -
      (session.rotatedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
    if (rotatedAgoMs < REFRESH_REUSE_GRACE_MS) {
      return true;
    }
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    this.logger.warn(
      { sessionId: session.id },
      "Refresh token reused after rotation; session revoked",
    );
    return false;
  }

  /**
   * Email is sent after the request has its answer, so a slow mail server
   * cannot delay sign-up or reveal anything through timing. Milestone 3 moves
   * this to the transactional outbox, which adds retries.
   */
  private sendInBackground(message: MailMessage): void {
    this.mailer.send(message).catch((error: unknown) => {
      this.logger.error({ err: error }, "Sending email failed");
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}
