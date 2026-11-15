import { Inject, Injectable } from "@nestjs/common";

import { recordSystemAudit } from "../audit/audit.js";
import { PRISMA } from "../database/prisma.js";
import { lockEventById } from "../events/event-lock.queries.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { RealtimeSignals } from "../live/realtime-signals.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { anonymiseAttendee } from "./anonymise.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Attendees anonymised per query; the run loops until none are left. */
const BATCH = 500;

/** docs/03, section 8. */
const STREAM_CHECK_DAYS = 30;
const AUDIT_DAYS = 2 * 365;

export interface RetentionOutcome {
  readonly anonymised: number;
  readonly deleted: Readonly<Record<string, number>>;
}

/**
 * The daily retention job (FR-AD-6, docs/03 section 8). Idempotent: a second
 * run on the same day finds nothing to do.
 *
 * - Attendees of events that ended more than the workspace's retention
 *   period ago are anonymised, as an erasure on request would be, and each
 *   is audited as SYSTEM. So are those events' invitations.
 * - Used or expired links, expired sessions and stored idempotent responses,
 *   stream checks after 30 days and audit entries after two years are
 *   deleted.
 */
@Injectable()
export class RetentionJob {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly signals: RealtimeSignals,
  ) {}

  async run(): Promise<RetentionOutcome> {
    const now = this.clock.now();
    let anonymised = 0;
    for (;;) {
      const due = await this.prisma.$queryRaw<
        { id: string; event_id: string; workspace_id: string }[]
      >`
        SELECT attendee.id, attendee.event_id, event.workspace_id
        FROM attendees AS attendee
        JOIN events AS event ON event.id = attendee.event_id
        JOIN workspaces AS workspace ON workspace.id = event.workspace_id
        WHERE attendee.status <> 'ERASED'
          AND event.ends_at + workspace.retention_days * interval '1 day' <= ${now}
        ORDER BY attendee.id
        LIMIT ${BATCH}`;
      const ended: string[] = [];
      for (const attendee of due) {
        if (await this.anonymise(attendee, now)) {
          anonymised += 1;
          ended.push(attendee.id);
        }
      }
      // Anyone still connected to such an old event is disconnected.
      await this.signals.recheck("attendee", ended);
      if (due.length < BATCH) {
        break;
      }
    }
    const deleted = {
      invitations: await this.prisma.$executeRaw`
        DELETE FROM attendee_invitations AS invitation
        USING events AS event, workspaces AS workspace
        WHERE event.id = invitation.event_id
          AND workspace.id = event.workspace_id
          AND event.ends_at + workspace.retention_days * interval '1 day' <= ${now}`,
      verificationLinks: (
        await this.prisma.attendeeVerificationToken.deleteMany({
          where: {
            OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }],
          },
        })
      ).count,
      passwordResetLinks: (
        await this.prisma.passwordResetToken.deleteMany({
          where: {
            OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }],
          },
        })
      ).count,
      attendeeSessions: (
        await this.prisma.attendeeSession.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count,
      idempotencyRecords: (
        await this.prisma.idempotencyRecord.deleteMany({
          where: { expiresAt: { lte: now } },
        })
      ).count,
      streamChecks: (
        await this.prisma.streamCheck.deleteMany({
          where: {
            checkedAt: {
              lt: new Date(now.getTime() - STREAM_CHECK_DAYS * DAY_MS),
            },
          },
        })
      ).count,
      auditEntries: (
        await this.prisma.auditEntry.deleteMany({
          where: {
            createdAt: { lt: new Date(now.getTime() - AUDIT_DAYS * DAY_MS) },
          },
        })
      ).count,
    };
    return { anonymised, deleted };
  }

  /** The event's row, then the attendee's: the order every path takes. */
  private async anonymise(
    attendee: { id: string; event_id: string; workspace_id: string },
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockEventById(tx, attendee.event_id))) {
        return false;
      }
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM attendees WHERE id = ${attendee.id}::uuid FOR UPDATE`;
      if (
        locked === undefined ||
        !(await anonymiseAttendee(tx, attendee.id, now))
      ) {
        return false;
      }
      await recordSystemAudit(tx, attendee.workspace_id, {
        action: "attendee.anonymised",
        targetType: "attendee",
        targetId: attendee.id,
        eventId: attendee.event_id,
      });
      return true;
    });
  }
}
