import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { hashToken } from "../auth/tokens.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { readAttendeeCookie } from "./attendee-cookies.js";
import { admitsAttendance } from "./domain/admission.js";
import { hasLiveInvitation } from "./invitation.queries.js";

/** The attendee making a request, loaded fresh by AttendeeGuard. */
export interface AttendeeActor {
  readonly attendeeId: string;
  readonly sessionId: string;
  readonly eventId: string;
  readonly workspaceId: string;
  readonly slug: string;
}

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
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectPinoLogger(AttendeeGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAttendee>();
    const token = readAttendeeCookie(request);
    if (token === undefined) {
      throw new DomainError("UNAUTHENTICATED");
    }
    const session = await this.prisma.attendeeSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        attendee: {
          select: {
            id: true,
            email: true,
            status: true,
            event: {
              select: {
                id: true,
                slug: true,
                status: true,
                workspaceId: true,
                accessPolicy: { select: { mode: true, allowedDomains: true } },
              },
            },
          },
        },
      },
    });
    if (session === null || session.expiresAt <= this.clock.now()) {
      throw new DomainError("UNAUTHENTICATED");
    }
    const { attendee } = session;
    const { event } = attendee;
    if (request.params.slug !== event.slug) {
      throw new DomainError("NOT_FOUND");
    }
    // Logged as the workspace, like staff requests (docs/02, section 7.9).
    this.logger.assign({ workspaceId: event.workspaceId });
    const admission = admitsAttendance({
      attendeeStatus: attendee.status,
      eventStatus: event.status,
      policy: event.accessPolicy,
      email: attendee.email,
      invited: await hasLiveInvitation(this.prisma, event.id, attendee.email),
    });
    if (!admission.admitted) {
      throw new DomainError("FORBIDDEN", {
        detail: "You no longer have access to this event.",
      });
    }
    request.attendee = {
      attendeeId: attendee.id,
      sessionId: session.id,
      eventId: event.id,
      workspaceId: event.workspaceId,
      slug: event.slug,
    };
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
