import { Inject, Injectable } from "@nestjs/common";
import type {
  AttendeeInvitation,
  AttendeePage,
  AttendeeQuery,
  StaffAttendee,
} from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import { isDemoWorkspace } from "../demo/demo-workspace.js";
import { lockEvent, lockWritableEvent } from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { decodeCursor, encodeCursor } from "../http/cursor.js";
import { Mailer } from "../mail/mailer.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { anonymiseAttendee, revokeAttendee } from "./anonymise.js";
import { invitationEmail } from "./attendee-emails.js";
import { maskEmail } from "./domain/privacy.js";

const AttendeePosition = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

const ATTENDEE_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  remindersOptIn: true,
  createdAt: true,
  verifiedAt: true,
} as const satisfies Prisma.AttendeeSelect;

type AttendeeRow = Prisma.AttendeeGetPayload<{
  select: typeof ATTENDEE_SELECT;
}>;

/**
 * The staff side of admission (docs/04, section 3.4): who registered, and
 * revoking, erasing and inviting them. Every write locks the event row and
 * then the attendee's, the order the demo reset and every other event write
 * take.
 */
@Injectable()
export class AudienceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
    @InjectPinoLogger(AudienceService.name) private readonly logger: PinoLogger,
  ) {}

  /** Newest registration first. Analysts see addresses masked. */
  async list(
    actor: Actor,
    eventId: string,
    query: AttendeeQuery,
  ): Promise<AttendeePage> {
    await this.assertEventVisible(this.prisma, actor, eventId);
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, AttendeePosition);
    const rows = await this.prisma.attendee.findMany({
      where: {
        eventId,
        ...(query.status !== undefined && { status: query.status }),
        ...(after !== undefined && {
          OR: [
            { createdAt: { lt: new Date(after.createdAt) } },
            { createdAt: new Date(after.createdAt), id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: ATTENDEE_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toStaffAttendee(row, actor)),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * Ends the attendee's access (FR-AD-4): the next request of any of their
   * sessions is refused. Revoking again changes nothing.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`
   */
  async revoke(
    actor: Actor,
    eventId: string,
    attendeeId: string,
  ): Promise<StaffAttendee> {
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      await this.lockAttendee(tx, eventId, attendeeId);
      if (await revokeAttendee(tx, attendeeId, this.clock.now())) {
        await recordAudit(tx, actor, {
          action: "attendee.revoked",
          targetType: "attendee",
          targetId: attendeeId,
          eventId,
        });
      }
      return toStaffAttendee(await this.read(tx, attendeeId), actor);
    });
  }

  /**
   * Erases the attendee on request (FR-AD-6): anonymised at once, as the
   * retention job would. Also allowed once the event is archived: the right
   * to erasure does not end with the event. Erasing again changes nothing.
   *
   * @throws DomainError `NOT_FOUND`
   */
  async erase(
    actor: Actor,
    eventId: string,
    attendeeId: string,
  ): Promise<StaffAttendee> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, actor.workspaceId, eventId);
      if (event === undefined) {
        throw new DomainError("NOT_FOUND");
      }
      await this.lockAttendee(tx, eventId, attendeeId);
      if (await anonymiseAttendee(tx, attendeeId, this.clock.now())) {
        // Nothing personal in the trail: who erased whom, not their data.
        await recordAudit(tx, actor, {
          action: "attendee.erased",
          targetType: "attendee",
          targetId: attendeeId,
          eventId,
        });
      }
      return toStaffAttendee(await this.read(tx, attendeeId), actor);
    });
  }

  /** The event's live invitations, newest first. */
  async invitations(
    actor: Actor,
    eventId: string,
  ): Promise<AttendeeInvitation[]> {
    await this.assertEventVisible(this.prisma, actor, eventId);
    const rows = await this.prisma.attendeeInvitation.findMany({
      where: { eventId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, email: true, createdAt: true },
    });
    return rows.map(toInvitation);
  }

  /**
   * Invites an address (FR-AD-4) and emails it a link to the event page.
   * Inviting an address that already has a live invitation returns that
   * invitation and sends nothing. In the demo workspace nothing is sent: the
   * invitee's mail reaches the demo inbox once they register.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`
   */
  async invite(
    actor: Actor,
    eventId: string,
    email: string,
  ): Promise<AttendeeInvitation> {
    const { invitation, created, event } = await this.prisma.$transaction(
      async (tx) => {
        await lockWritableEvent(tx, actor.workspaceId, eventId);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { slug: true, title: true },
        });
        const existing = await tx.attendeeInvitation.findFirst({
          where: { eventId, email, revokedAt: null },
          select: { id: true, email: true, createdAt: true },
        });
        if (existing !== null) {
          return { invitation: existing, created: false, event };
        }
        const invitation = await tx.attendeeInvitation.create({
          data: {
            eventId,
            email,
            invitedById: actor.userId,
            createdAt: this.clock.now(),
          },
          select: { id: true, email: true, createdAt: true },
        });
        await recordAudit(tx, actor, {
          action: "attendee_invitation.created",
          targetType: "attendee_invitation",
          targetId: invitation.id,
          eventId,
        });
        return { invitation, created: true, event };
      },
    );
    if (created && !isDemoWorkspace(actor.workspaceId)) {
      this.mailer
        .send(invitationEmail(email, event, this.config.app.origin))
        .catch((error: unknown) => {
          // The address is personal data: logged by invitation only.
          this.logger.error(
            { err: error, invitationId: invitation.id },
            "Could not send an event invitation",
          );
        });
    }
    return toInvitation(invitation);
  }

  /**
   * Revokes an invitation; the attendee who registered with that address
   * loses access too (docs/04, section 3.4). Revoking again changes nothing.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`
   */
  async revokeInvitation(actor: Actor, invitationId: string): Promise<void> {
    const found = await this.prisma.attendeeInvitation.findFirst({
      where: { id: invitationId, event: { workspaceId: actor.workspaceId } },
      select: { eventId: true },
    });
    if (found === null) {
      throw new DomainError("NOT_FOUND");
    }
    await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, found.eventId);
      const now = this.clock.now();
      const [invitation] = await tx.$queryRaw<{ email: string }[]>`
        UPDATE attendee_invitations SET revoked_at = ${now}
        WHERE id = ${invitationId}::uuid AND revoked_at IS NULL
        RETURNING email::text AS email`;
      if (invitation === undefined) {
        return;
      }
      await recordAudit(tx, actor, {
        action: "attendee_invitation.revoked",
        targetType: "attendee_invitation",
        targetId: invitationId,
        eventId: found.eventId,
      });
      const [attendee] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM attendees
        WHERE event_id = ${found.eventId}::uuid
          AND email = ${invitation.email}::citext
        FOR UPDATE`;
      if (
        attendee !== undefined &&
        (await revokeAttendee(tx, attendee.id, now))
      ) {
        await recordAudit(tx, actor, {
          action: "attendee.revoked",
          targetType: "attendee",
          targetId: attendee.id,
          eventId: found.eventId,
        });
      }
    });
  }

  private async lockAttendee(
    tx: Prisma.TransactionClient,
    eventId: string,
    attendeeId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM attendees
      WHERE id = ${attendeeId}::uuid AND event_id = ${eventId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new DomainError("NOT_FOUND");
    }
  }

  private read(
    client: Prisma.TransactionClient,
    attendeeId: string,
  ): Promise<AttendeeRow> {
    return client.attendee.findUniqueOrThrow({
      where: { id: attendeeId },
      select: ATTENDEE_SELECT,
    });
  }

  private async assertEventVisible(
    client: Prisma.TransactionClient,
    actor: Actor,
    eventId: string,
  ): Promise<void> {
    const event = await client.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
  }
}

/** An erased attendee has no address; Analysts see the others masked. */
function visibleEmail(row: AttendeeRow, actor: Actor): string | null {
  if (row.status === "ERASED") {
    return null;
  }
  return actor.role === "ANALYST" ? maskEmail(row.email) : row.email;
}

function toStaffAttendee(row: AttendeeRow, actor: Actor): StaffAttendee {
  const email = visibleEmail(row, actor);
  return {
    id: row.id,
    name: row.name,
    email,
    status: row.status,
    remindersOptIn: row.remindersOptIn,
    registeredAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

function toInvitation(row: {
  id: string;
  email: string;
  createdAt: Date;
}): AttendeeInvitation {
  return {
    id: row.id,
    email: row.email,
    invitedAt: row.createdAt.toISOString(),
  };
}
