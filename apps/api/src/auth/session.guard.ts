import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

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
import { requestIdOf } from "../observability/request-id.js";

/**
 * The workspace the client believes is active. The active workspace lives in
 * the session, so a request sent just before a switch (or from a tab that has
 * not noticed a switch made in another tab) would otherwise be answered with
 * another workspace's data. With this header the API refuses instead.
 */
export const WORKSPACE_HEADER = "x-workspace-id";

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
    @InjectPinoLogger(SessionGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.loadActor(
      readAccessCookie(request),
      requestIdOf(request),
    );
    if (actor === undefined) {
      throw new DomainError("UNAUTHENTICATED");
    }
    // Every line logged for the rest of this request names the workspace
    // (docs/02, section 7.9), and so does the request's summary line: also
    // when the checks below refuse the request.
    request.actor = actor;
    this.logger.assign({ workspaceId: actor.workspaceId });
    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(
      REQUIRED_ROLE,
      targets,
    );
    const expectedWorkspace = request.get(WORKSPACE_HEADER);
    if (
      expectedWorkspace !== undefined &&
      expectedWorkspace !== actor.workspaceId
    ) {
      throw new DomainError("WORKSPACE_CHANGED");
    }
    if (requiredRole !== undefined && !hasRole(actor.role, requiredRole)) {
      throw new DomainError("FORBIDDEN");
    }
    return true;
  }

  private async loadActor(
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
