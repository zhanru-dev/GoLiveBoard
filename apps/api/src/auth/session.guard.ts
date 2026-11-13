import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@opspilot/contracts";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { verifyAccessToken } from "./access-token.js";
import {
  type Actor,
  hasRole,
  IS_PUBLIC,
  REQUIRED_ROLE,
  type RequestWithActor,
} from "./actor.js";
import { readAccessCookie } from "./cookies.js";

/**
 * Runs before every route that is not @Public(). The access token only names
 * a session; the session, the user and the membership are loaded fresh on
 * every request, so sign-out, removal and role changes apply at once
 * (FR-WS-3, FR-AUTH-3).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.loadActor(readAccessCookie(request));
    if (actor === undefined) {
      throw new DomainError("UNAUTHENTICATED");
    }
    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(
      REQUIRED_ROLE,
      targets,
    );
    if (requiredRole !== undefined && !hasRole(actor.role, requiredRole)) {
      throw new DomainError("FORBIDDEN");
    }
    request.actor = actor;
    return true;
  }

  private async loadActor(
    accessToken: string | undefined,
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
    };
  }
}
