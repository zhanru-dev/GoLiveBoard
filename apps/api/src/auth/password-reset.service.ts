import { Inject, Injectable } from "@nestjs/common";
import type {
  PasswordResetConfirmRequest,
  PasswordResetRequest,
} from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Mailer } from "../mail/mailer.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { passwordResetEmail } from "./emails.js";
import { hashPassword } from "./password-hasher.js";
import { generateToken, hashToken } from "./tokens.js";

/** FR-AUTH-4: a reset link works once, within 30 minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
    private readonly rateLimiter: RateLimiter,
    @InjectPinoLogger(PasswordResetService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Emails a reset link if the account exists. The caller always answers
   * `202` with the same body, so the response reveals nothing.
   */
  async request(input: PasswordResetRequest, ip: string): Promise<void> {
    await this.rateLimiter.consumeOrThrow(RATE_LIMITS.passwordResetPerIp, ip);
    if (
      !(await this.rateLimiter.consume(
        RATE_LIMITS.passwordResetPerAccount,
        input.email,
      ))
    ) {
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, disabledAt: true },
    });
    // Unknown and disabled accounts get no email, and no different answer.
    if (user?.disabledAt !== null) {
      return;
    }
    const token = generateToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(this.clock.now().getTime() + PASSWORD_RESET_TTL_MS),
      },
    });
    this.mailer
      .send(passwordResetEmail(user.email, token, this.config.app.origin))
      .catch((error: unknown) => {
        this.logger.error(
          { err: error },
          "Sending password reset email failed",
        );
      });
  }

  /**
   * Sets the new password and signs the user out everywhere. Marking the token
   * used is the first, conditional step, so a link cannot be used twice even
   * by two requests at the same moment.
   */
  async confirm(input: PasswordResetConfirmRequest): Promise<void> {
    const now = this.clock.now();
    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const tokenHash = hashToken(input.token);
      const { count } = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) {
        throw new DomainError("TOKEN_INVALID");
      }
      const { userId } = await tx.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash },
        select: { userId: true },
      });
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Other links sent before this one must not work any more.
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }
}
