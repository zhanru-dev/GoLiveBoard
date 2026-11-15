import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { verifyAccessToken } from "./access-token.js";
import type { Actor } from "./actor.js";

/**
 * Loads the staff member an access token names, fresh from the database:
 * the session, the user and the membership of the session's active
 * workspace. Shared by SessionGuard (HTTP) and the real-time gateway, so a
 * socket is held to exactly the rules a request is.
 */
@Injectable()
export class ActorLoader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** @returns undefined for a missing, invalid, expired or revoked session */
  async load(
    accessToken: string | undefined,
    requestId: string,
  ): Promise<Actor | undefined> {
    if (accessToken === undefined) {
      return undefined;
    }
    const now = this.clock.now();
    const sessionId = await verifyAccessToken(
      accessToken,
      {
        current: this.config.auth.jwtSecret,
        previous: this.config.auth.jwtPreviousSecret,
      },
      now,
    );
    if (sessionId === undefined) {
      return undefined;
    }
    return this.loadSession(sessionId, requestId);
  }

  /**
   * Loads a session the caller already authenticated, e.g. a real-time
   * connection that showed an access token when it connected: the token
   * expires after 15 minutes, the connection is held to its session.
   *
   * @returns undefined for an unknown, expired or revoked session, a disabled
   * user, or one no longer a member of the session's active workspace
   */
  async loadSession(
    sessionId: string,
    requestId: string,
  ): Promise<Actor | undefined> {
    const now = this.clock.now();
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { memberships: true } } },
    });
    if (session === null) {
      return undefined;
    }
    if (
      session.revokedAt !== null ||
      session.refreshExpiresAt <= now ||
      session.user.disabledAt !== null
    ) {
      return undefined;
    }
    const membership = session.user.memberships.find(
      (candidate) => candidate.workspaceId === session.activeWorkspaceId,
    );
    if (membership === undefined) {
      return undefined;
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      workspaceId: session.activeWorkspaceId,
      role: membership.role,
      requestId,
    };
  }
}
