import { Inject, Injectable } from "@nestjs/common";
import type { EventStatus } from "@opspilot/contracts";

import { AttendeeSessions } from "../attendees/attendee-sessions.js";
import { hasRole } from "../auth/actor.js";
import { ActorLoader } from "../auth/actor-loader.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  isInteractionOpen,
  isInteractionReadable,
} from "./domain/interaction.js";

/**
 * The sessions a real-time connection showed when it connected: a staff
 * session, an attendee session, or both (one browser can hold both).
 * Everything else is loaded fresh whenever access is decided.
 */
export interface Identity {
  readonly staffSessionId?: string;
  readonly attendeeSessionId?: string;
}

/** The sessions behind an identity that are still valid, and who they are. */
export interface LiveIdentity {
  readonly identity: Identity;
  readonly staff?: { readonly sessionId: string; readonly userId: string };
  readonly attendee?: {
    readonly sessionId: string;
    readonly attendeeId: string;
    readonly eventId: string;
  };
}

/** Someone taking part in one event's live interaction. */
export interface Participant {
  readonly kind: "STAFF" | "ATTENDEE";
  readonly eventId: string;
  readonly workspaceId: string;
  readonly slug: string;
  readonly status: EventStatus;
  /** Set for staff. */
  readonly userId?: string;
  /** Set for attendees. */
  readonly attendeeId?: string;
  /** Managers and Owners moderate chat and Q&A (FR-RN-3, FR-RN-5). */
  readonly moderator: boolean;
  /** Whether the event takes new messages, questions and votes. */
  readonly open: boolean;
}

export type Authorization =
  | { readonly ok: true; readonly participant: Participant }
  | {
      readonly ok: false;
      readonly error: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CLOSED";
    };

/** How a connection names an event: by slug when it joins, by ID after. */
export type EventRef = { readonly slug: string } | { readonly id: string };

/**
 * Decides who may take part in an event's chat and Q&A, with the same rules
 * as HTTP (docs/02, section 7.1): a staff member of the event's workspace,
 * or an attendee the event still admits. Nothing is cached; every decision
 * reloads the sessions, the membership, the attendee and the event.
 */
@Injectable()
export class Participants {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly actors: ActorLoader,
    private readonly attendeeSessions: AttendeeSessions,
  ) {}

  /**
   * Reloads an identity's sessions.
   *
   * @returns the sessions still valid; or, when none is, why: every session
   * ended (`SIGNED_OUT`), or an attendee session goes on but its event no
   * longer admits them (`ACCESS_REVOKED`)
   */
  async reload(
    identity: Identity,
    requestId: string,
  ): Promise<LiveIdentity | "SIGNED_OUT" | "ACCESS_REVOKED"> {
    const [actor, check] = await Promise.all([
      identity.staffSessionId === undefined
        ? undefined
        : this.actors.loadSession(identity.staffSessionId, requestId),
      identity.attendeeSessionId === undefined
        ? undefined
        : this.attendeeSessions.byId(identity.attendeeSessionId),
    ]);
    const attendee = check?.admitted === true ? check.attendee : undefined;
    if (actor === undefined && attendee === undefined) {
      return check === undefined ? "SIGNED_OUT" : "ACCESS_REVOKED";
    }
    return {
      identity: {
        staffSessionId: actor?.sessionId,
        attendeeSessionId: attendee?.sessionId,
      },
      staff:
        actor === undefined
          ? undefined
          : { sessionId: actor.sessionId, userId: actor.userId },
      attendee:
        attendee === undefined
          ? undefined
          : {
              sessionId: attendee.sessionId,
              attendeeId: attendee.attendeeId,
              eventId: attendee.eventId,
            },
    };
  }

  /**
   * Decides whether an identity takes part in an event, and how. Staff of
   * the event's workspace come first: their moderation rights matter more
   * than an attendee session in the same browser.
   */
  async authorize(
    identity: Identity,
    ref: EventRef,
    requestId: string,
  ): Promise<Authorization> {
    const [event, actor, check] = await Promise.all([
      this.prisma.event.findFirst({
        where: "slug" in ref ? { slug: ref.slug } : { id: ref.id },
        select: { id: true, workspaceId: true, slug: true, status: true },
      }),
      identity.staffSessionId === undefined
        ? undefined
        : this.actors.loadSession(identity.staffSessionId, requestId),
      identity.attendeeSessionId === undefined
        ? undefined
        : this.attendeeSessions.byId(identity.attendeeSessionId),
    ]);
    if (actor === undefined && check?.admitted !== true) {
      // Signed out, or only an attendee session the event no longer admits.
      return check === undefined
        ? { ok: false, error: "UNAUTHENTICATED" }
        : { ok: false, error: "FORBIDDEN" };
    }
    if (event === null) {
      return { ok: false, error: "NOT_FOUND" };
    }
    const base = {
      eventId: event.id,
      workspaceId: event.workspaceId,
      slug: event.slug,
      status: event.status,
      open: isInteractionOpen(event.status),
    };
    if (actor?.workspaceId === event.workspaceId) {
      if (!isInteractionReadable(event.status)) {
        return { ok: false, error: "CLOSED" };
      }
      return {
        ok: true,
        participant: {
          ...base,
          kind: "STAFF",
          userId: actor.userId,
          moderator: hasRole(actor.role, "MANAGER"),
        },
      };
    }
    if (check?.attendee.eventId === event.id) {
      // admitsAttendance already refuses an event that is not readable.
      return check.admitted
        ? {
            ok: true,
            participant: {
              ...base,
              kind: "ATTENDEE",
              attendeeId: check.attendee.attendeeId,
              moderator: false,
            },
          }
        : { ok: false, error: "FORBIDDEN" };
    }
    // Another workspace's event, or another event than the attendee's.
    return { ok: false, error: "NOT_FOUND" };
  }
}
