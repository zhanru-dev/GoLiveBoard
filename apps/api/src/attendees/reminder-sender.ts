import { Inject, Injectable } from "@nestjs/common";
import type { AttendeeStatus } from "@goliveboard/contracts";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import { lockEventById } from "../events/event-lock.queries.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { reminderEmail } from "./attendee-emails.js";
import { AttendeeMail } from "./attendee-mail.js";
import { admitsAttendance } from "./domain/admission.js";
import {
  dueReminder,
  isRemindable,
  REMINDER_LEAD_MS,
} from "./domain/reminders.js";
import { hasLiveInvitation } from "./invitation.queries.js";
import { unsubscribeToken } from "./unsubscribe-token.js";

/** Attendees reminded per attendee query; the next run goes on. */
const BATCH = 500;

/**
 * Sends the reminders that are due (FR-AD-5): 24 hours and 1 hour before the
 * start, to verified attendees who still want them and are still admitted.
 *
 * At most once: each reminder is recorded in `reminder_deliveries`, whose
 * primary key allows one per attendee and kind, in the transaction that
 * decides to send it, before anything is sent. A run that repeats, or two
 * workers running at once, find the record and send nothing; a crash
 * between the commit and the send loses that reminder rather than sending
 * it twice.
 */
@Injectable()
export class ReminderSender {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mail: AttendeeMail,
  ) {}

  /** @returns how many reminders this run sent */
  async sendDue(): Promise<number> {
    const now = this.clock.now();
    const hour = new Date(now.getTime() + REMINDER_LEAD_MS.HOUR_BEFORE);
    const day = new Date(now.getTime() + REMINDER_LEAD_MS.DAY_BEFORE);
    // Candidates only: each is decided again under its lock.
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT attendee.id FROM attendees AS attendee
      JOIN events AS event ON event.id = attendee.event_id
      WHERE attendee.status = 'VERIFIED' AND attendee.reminders_opt_in
        AND event.status IN ('CONFIGURING', 'READY')
        AND event.starts_at > ${now} AND event.starts_at <= ${day}
        AND NOT EXISTS (
          SELECT 1 FROM reminder_deliveries AS sent
          WHERE sent.attendee_id = attendee.id
            AND sent.kind = (CASE WHEN event.starts_at <= ${hour}
                                  THEN 'HOUR_BEFORE' ELSE 'DAY_BEFORE'
                             END)::reminder_kind)
      ORDER BY event.starts_at, attendee.id
      LIMIT ${BATCH}`;
    let sent = 0;
    for (const { id } of due) {
      if (await this.remind(id)) {
        sent += 1;
      }
    }
    return sent;
  }

  private async remind(attendeeId: string): Promise<boolean> {
    const send = await this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      // The event's row, then the attendee's: the order of every path that
      // locks both. While both are held, neither the event's status and
      // policy nor the attendee can change, so the decision below holds
      // until the reminder is recorded.
      const [owner] = await tx.$queryRaw<{ event_id: string }[]>`
        SELECT event_id FROM attendees WHERE id = ${attendeeId}::uuid`;
      if (owner === undefined || !(await lockEventById(tx, owner.event_id))) {
        return undefined;
      }
      const [locked] = await tx.$queryRaw<
        { status: AttendeeStatus; reminders_opt_in: boolean }[]
      >`
        SELECT status, reminders_opt_in FROM attendees
        WHERE id = ${attendeeId}::uuid
        FOR UPDATE`;
      if (!locked?.reminders_opt_in) {
        return undefined;
      }
      const attendee = await tx.attendee.findUniqueOrThrow({
        where: { id: attendeeId },
        select: {
          email: true,
          demoInboxKeyHash: true,
          event: {
            select: {
              id: true,
              workspaceId: true,
              slug: true,
              title: true,
              status: true,
              startsAt: true,
              timeZone: true,
              accessPolicy: { select: { mode: true, allowedDomains: true } },
            },
          },
        },
      });
      const { event } = attendee;
      const kind = dueReminder(event.startsAt, now);
      const admission = admitsAttendance({
        attendeeStatus: locked.status,
        eventStatus: event.status,
        policy: event.accessPolicy,
        email: attendee.email,
        invited: await hasLiveInvitation(tx, event.id, attendee.email),
      });
      if (
        kind === undefined ||
        !isRemindable(event.status) ||
        !admission.admitted
      ) {
        return undefined;
      }
      const recorded = await tx.$queryRaw<{ kind: string }[]>`
        INSERT INTO reminder_deliveries (attendee_id, kind, created_at)
        VALUES (${attendeeId}::uuid, ${kind}::reminder_kind, ${now})
        ON CONFLICT (attendee_id, kind) DO NOTHING
        RETURNING kind::text AS kind`;
      if (recorded.length === 0) {
        return undefined;
      }
      return this.mail.prepare(
        tx,
        {
          attendeeId,
          workspaceId: event.workspaceId,
          demoInboxKeyHash: attendee.demoInboxKeyHash,
        },
        reminderEmail(
          attendee.email,
          event,
          kind,
          unsubscribeToken(this.config.auth.jwtSecret, attendeeId),
          this.config.app.origin,
        ),
      );
    });
    send?.();
    return send !== undefined;
  }
}
