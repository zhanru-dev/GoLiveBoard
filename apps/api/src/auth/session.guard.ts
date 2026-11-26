import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@goliveboard/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { DomainError } from "../shared/domain/domain-error.js";
import {
  hasRole,
  IS_PUBLIC,
  REQUIRED_ROLE,
  type RequestWithActor,
} from "./actor.js";
import { ActorLoader } from "./actor-loader.js";
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
    private readonly actors: ActorLoader,
    @InjectPinoLogger(SessionGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = await this.actors.load(
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
}
