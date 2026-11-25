import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { DomainError } from "../shared/domain/domain-error.js";
import { readAttendeeCookie } from "./attendee-cookies.js";
import { type AttendeeActor, AttendeeSessions } from "./attendee-sessions.js";

export type { AttendeeActor } from "./attendee-sessions.js";

type RequestWithAttendee = Request & { attendee?: AttendeeActor };

/**
 * Admits an attendee to their event's routes (`/public/events/:slug/…`).
 * Every request reloads the session, the attendee, the event and its access
 * policy, and decides again (docs/02, section 7.1): a revocation, an erasure
 * or a stricter policy applies to the very next request (FR-AD-2, FR-AD-4).
 *
 * Without a session: `401`. With a session for another event: `404`, as if
 * the event did not exist for them. No longer admitted: `403`.
 */
@Injectable()
export class AttendeeGuard implements CanActivate {
  constructor(
    private readonly sessions: AttendeeSessions,
    @InjectPinoLogger(AttendeeGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAttendee>();
    const token = readAttendeeCookie(request);
    const check =
      token === undefined ? undefined : await this.sessions.byToken(token);
    if (check === undefined) {
      throw new DomainError("UNAUTHENTICATED");
    }
    const { attendee } = check;
    if (request.params.slug !== attendee.slug) {
      throw new DomainError("NOT_FOUND");
    }
    // Logged as the workspace, like staff requests (docs/02, section 7.9).
    this.logger.assign({ workspaceId: attendee.workspaceId });
    if (!check.admitted) {
      throw new DomainError("FORBIDDEN", {
        detail: "You no longer have access to this event.",
      });
    }
    request.attendee = attendee;
    return true;
  }
}

/** Injects the attendee that AttendeeGuard admitted. */
export const CurrentAttendee = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AttendeeActor => {
    const request = context.switchToHttp().getRequest<RequestWithAttendee>();
    if (request.attendee === undefined) {
      throw new Error("CurrentAttendee used on a route without AttendeeGuard");
    }
    return request.attendee;
  },
);
