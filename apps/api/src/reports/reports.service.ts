import { Inject, Injectable } from "@nestjs/common";
import type { EventReport, Incident } from "@opspilot/contracts";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { recordReport, StoredReport } from "./report-store.js";

const MINUTE_MS = 60_000;

/**
 * The post-event report (FR-RC-3). The audience figures were fixed when
 * the event completed (their minutes are deleted 30 days later); the rest
 * is read from the event's records each time, so a question marked
 * answered after the event still counts.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @throws DomainError NOT_FOUND, REPORT_NOT_AVAILABLE */
  async report(actor: Actor, eventId: string): Promise<EventReport> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timeZone: true,
        completedAt: true,
      },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    const stored = await this.stored(
      eventId,
      // Completed, or archived after completing (not after a cancellation).
      event.completedAt !== null || event.status === "COMPLETED",
    );
    const audience = StoredReport.parse(stored.data);
    const [registered, verified, asked, answered, messages, incidents] =
      await Promise.all([
        this.prisma.attendee.count({ where: { eventId } }),
        this.prisma.attendee.count({
          where: { eventId, verifiedAt: { not: null } },
        }),
        this.prisma.question.count({ where: { eventId } }),
        this.prisma.question.count({ where: { eventId, status: "ANSWERED" } }),
        this.prisma.$queryRaw<{ minute: Date; messages: number }[]>`
          SELECT date_trunc('minute', created_at) AS minute,
                 count(*)::int AS messages
          FROM chat_messages WHERE event_id = ${eventId}::uuid
          GROUP BY 1`,
        this.incidents(eventId),
      ]);
    const perMinute = new Map(
      messages.map(({ minute, messages: count }) => [minute.getTime(), count]),
    );
    return {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        status: event.status,
        timeZone: event.timeZone,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
      },
      generatedAt: stored.generatedAt.toISOString(),
      funnel: { registered, verified, attended: audience.attended },
      audience: {
        peak: audience.peak,
        average: audience.average,
        series: audience.series.map(({ minute, viewers }) => {
          const start = Date.parse(minute);
          return {
            minute,
            viewers,
            messages: perMinute.get(start) ?? 0,
            incident: incidents.some(
              (incident) =>
                Date.parse(incident.openedAt) < start + MINUTE_MS &&
                (incident.resolvedAt === null ||
                  Date.parse(incident.resolvedAt) > start),
            ),
          };
        }),
      },
      incidents,
      questions: { asked, answered },
      chat: {
        messages: messages.reduce((sum, { messages: count }) => sum + count, 0),
      },
    };
  }

  /**
   * The stored part. An event that completed before reports were stored
   * gets it now: its minutes are still there, as they are deleted only 30
   * days after a report.
   */
  private async stored(eventId: string, completed: boolean) {
    const found = await this.prisma.eventReport.findUnique({
      where: { eventId },
    });
    if (found !== null) {
      return found;
    }
    if (!completed) {
      throw new DomainError("REPORT_NOT_AVAILABLE");
    }
    await this.prisma.$transaction(async (tx) => {
      await recordReport(tx, eventId, this.clock.now());
    });
    return this.prisma.eventReport.findUniqueOrThrow({ where: { eventId } });
  }

  private async incidents(eventId: string): Promise<Incident[]> {
    const rows = await this.prisma.incident.findMany({
      where: { eventId },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }
}
