import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { Role } from "@opspilot/contracts";
import type { Request } from "express";

/** Who is making the request, loaded fresh from the database by SessionGuard. */
export interface Actor {
  readonly userId: string;
  readonly sessionId: string;
  /** The session's active workspace; every query is scoped by it. */
  readonly workspaceId: string;
  readonly role: Role;
  /** The request being served, recorded with audit entries to correlate them with logs. */
  readonly requestId: string;
}

export type RequestWithActor = Request & { actor?: Actor };

/**
 * Owners can do everything Managers can, and Managers everything Analysts can
 * (docs/04, section 3), so a route names the least role it needs.
 */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  ANALYST: 1,
  MANAGER: 2,
  OWNER: 3,
};

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const IS_PUBLIC = "opspilot:isPublic";
export const REQUIRED_ROLE = "opspilot:requiredRole";

/** The route needs no session (sign-in, health checks, …). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The route needs at least this role in the active workspace. */
export const RequireRole = (role: Role) => SetMetadata(REQUIRED_ROLE, role);

/** Injects the signed-in actor into a controller method. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    if (request.actor === undefined) {
      // Only reachable if a route uses @CurrentActor() and @Public() together.
      throw new Error("No actor: is this route marked @Public()?");
    }
    return request.actor;
  },
);
