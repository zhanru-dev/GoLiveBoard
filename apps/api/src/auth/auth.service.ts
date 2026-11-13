import { Inject, Injectable } from "@nestjs/common";
import type { SignInRequest, SignUpRequest } from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { Mailer, type MailMessage } from "../mail/mailer.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { type AccessTokenKeys, signAccessToken } from "./access-token.js";
import { REFRESH_TOKEN_TTL_MS, type SessionTokens } from "./cookies.js";
import { accountExistsEmail, welcomeEmail } from "./emails.js";
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "./password-hasher.js";
import { generateToken, hashToken } from "./tokens.js";

/**
 * A browser that sends two requests at once with the same refresh cookie
 * (two tabs, a retried request) presents the old token a moment after the
 * other request rotated it. That is not theft, so within this window the
 * session survives; after it, reuse means a copied token and the session is
 * revoked (ADR-0005).
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

const UNIQUE_VIOLATION = "P2002";

@Injectable()
export class AuthService {
  private readonly tokenKeys: AccessTokenKeys;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
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
  async signUp(input: SignUpRequest): Promise<void> {
    // Hash first and always, so both outcomes take the same time.
    const passwordHash = await hashPassword(input.password);
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
  async signIn(input: SignInRequest): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    const passwordMatches =
      user === null
        ? await verifyAgainstDummy(input.password)
        : await verifyPassword(user.passwordHash, input.password);
    if (user === null || !passwordMatches || user.disabledAt !== null) {
      throw new DomainError("CREDENTIALS_INVALID");
    }
    const [membership] = user.memberships;
    if (membership === undefined) {
      throw new DomainError("FORBIDDEN", {
        detail: "You are not a member of any workspace.",
      });
    }
    return this.startSession(user.id, membership.workspaceId);
  }

  /**
   * Exchanges a refresh token for a new pair. The old token stops working in
   * the same statement that issues the new one, so of two concurrent requests
   * with the same token exactly one succeeds (FR-AUTH-2).
   */
  async refresh(refreshToken: string): Promise<SessionTokens> {
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
      await this.revokeIfReused(presentedHash, now);
      throw new DomainError("UNAUTHENTICATED");
    }
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: nextHash },
      select: { id: true },
    });
    return {
      accessToken: await signAccessToken(session.id, this.tokenKeys, now),
      refreshToken: nextToken,
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

  private async startSession(
    userId: string,
    workspaceId: string,
  ): Promise<SessionTokens> {
    const now = this.clock.now();
    const refreshToken = generateToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        activeWorkspaceId: workspaceId,
        refreshTokenHash: hashToken(refreshToken),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    return {
      accessToken: await signAccessToken(session.id, this.tokenKeys, now),
      refreshToken,
    };
  }

  /** A token that was rotated away came back: someone may have a copy. */
  private async revokeIfReused(presentedHash: string, now: Date) {
    const session = await this.prisma.session.findUnique({
      where: { previousRefreshTokenHash: presentedHash },
      select: { id: true, rotatedAt: true, revokedAt: true },
    });
    if (session === null) {
      return;
    }
    if (session.revokedAt !== null) {
      return;
    }
    const rotatedAgoMs =
      now.getTime() -
      (session.rotatedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
    if (rotatedAgoMs < REFRESH_REUSE_GRACE_MS) {
      return;
    }
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    this.logger.warn(
      { sessionId: session.id },
      "Refresh token reused after rotation; session revoked",
    );
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
