import { Inject, Injectable } from "@nestjs/common";

import { hashToken } from "../auth/tokens.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { admitsAttendance } from "./domain/admission.js";
import { hasLiveInvitation } from "./invitation.queries.js";

/** An attendee with a session, as AttendeeGuard and the gateway see them. */
export interface AttendeeActor {
  readonly attendeeId: string;
  readonly sessionId: string;
  readonly eventId: string;
  readonly workspaceId: string;
  readonly slug: string;
}

/** A live session, and whether its attendee is still admitted to the event. */
export interface AttendeeSessionCheck {
  readonly attendee: AttendeeActor;
  readonly admitted: boolean;
}

/**
 * Loads attendee sessions, fresh from the database, and decides admission
 * again (docs/02, section 7.1): the session, the attendee, the event, its
 * access policy and the invitations. Shared by AttendeeGuard (HTTP) and the
 * real-time gateway, so both apply exactly the same rules.
 */
@Injectable()
export class AttendeeSessions {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @returns undefined for an unknown or expired session */
  byToken(token: string): Promise<AttendeeSessionCheck | undefined> {
    return this.load({ tokenHash: hashToken(token) });
  }

  /**
   * For a session already authenticated, e.g. by a real-time connection.
   *
   * @param client - a transaction, to decide under its locks
   */
  byId(
    sessionId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<AttendeeSessionCheck | undefined> {
    return this.load({ id: sessionId }, client);
  }

  private async load(
    where: Prisma.AttendeeSessionWhereUniqueInput,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<AttendeeSessionCheck | undefined> {
    const session = await client.attendeeSession.findUnique({
      where,
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
      return undefined;
    }
    const { attendee } = session;
    const { event } = attendee;
    const admission = admitsAttendance({
      attendeeStatus: attendee.status,
      eventStatus: event.status,
      policy: event.accessPolicy,
      email: attendee.email,
      invited: await hasLiveInvitation(client, event.id, attendee.email),
    });
    return {
      attendee: {
        attendeeId: attendee.id,
        sessionId: session.id,
        eventId: event.id,
        workspaceId: event.workspaceId,
        slug: event.slug,
      },
      admitted: admission.admitted,
    };
  }
}
