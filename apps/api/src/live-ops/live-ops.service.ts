import { Inject, Injectable } from "@nestjs/common";
import {
  EventStatus,
  type Incident,
  type LiveOps,
  type LiveOpsAudience,
  type LiveOpsMoment,
  type LiveOpsRates,
  type LiveOpsStreamStatus,
} from "@opspilot/contracts";
import { z } from "zod";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { summariseAudience } from "../reports/domain/audience.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

const MINUTE_MS = 60_000;
const StatusOf = z.object({ status: EventStatus });

export interface EventState {
  readonly status: EventStatus;
  readonly checkedAt: string | null;
  readonly incidents: readonly Incident[];
}

/**
 * The operations room's figures (FR-RN-7), read from the database each
 * time: every API instance sees the same, with no message to lose.
 */
@Injectable()
export class LiveOpsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @throws DomainError NOT_FOUND for an event outside the workspace */
  async snapshot(actor: Actor, eventId: string): Promise<LiveOps> {
    const now = this.clock.now();
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    const [stream, audience, rates, incidents, transitions] = await Promise.all(
      [
        this.streamStatus(eventId),
        this.audienceWithSeries(eventId, event.startsAt, event.endsAt, now),
        this.rates(eventId, now),
        this.incidents(eventId),
        this.prisma.auditEntry.findMany({
          where: { eventId, action: "event.transitioned" },
          select: { createdAt: true, before: true, after: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ],
    );
    const timeline: LiveOpsMoment[] = [
      ...transitions.flatMap((entry): LiveOpsMoment[] => {
        const from = StatusOf.safeParse(entry.before);
        const to = StatusOf.safeParse(entry.after);
        return from.success && to.success
          ? [
              {
                kind: "STATUS_CHANGED",
                at: entry.createdAt.toISOString(),
                from: from.data.status,
                to: to.data.status,
              },
            ]
          : [];
      }),
      ...incidents.flatMap((incident): LiveOpsMoment[] => [
        {
          kind: "INCIDENT_OPENED",
          at: incident.openedAt,
          incidentId: incident.id,
          incidentKind: incident.kind,
        },
        ...(incident.resolvedAt === null
          ? []
          : [
              {
                kind: "INCIDENT_RESOLVED" as const,
                at: incident.resolvedAt,
                incidentId: incident.id,
                incidentKind: incident.kind,
              },
            ]),
      ]),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
      },
      stream,
      audience,
      rates,
      incidents: incidents
        .filter(({ resolvedAt }) => resolvedAt === null)
        .reverse(),
      timeline,
      at: now.toISOString(),
    };
  }

  /**
   * What the stream compares each second; undefined once the event is no
   * longer in the workspace.
   */
  async state(
    workspaceId: string,
    eventId: string,
  ): Promise<EventState | undefined> {
    const [event, stream, incidents] = await Promise.all([
      this.prisma.event.findFirst({
        where: { id: eventId, workspaceId },
        select: { status: true },
      }),
      this.streamStatus(eventId),
      this.incidents(eventId),
    ]);
    if (event === null) {
      return undefined;
    }
    return {
      status: event.status,
      checkedAt: stream?.checkedAt ?? null,
      incidents,
    };
  }

  async streamStatus(eventId: string): Promise<LiveOpsStreamStatus | null> {
    const check = await this.prisma.streamCheck.findFirst({
      where: { eventId },
      orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
      select: { ok: true, checkedAt: true, latencyMs: true },
    });
    return check === null
      ? null
      : {
          ok: check.ok,
          checkedAt: check.checkedAt.toISOString(),
          latencyMs: check.latencyMs,
        };
  }

  /**
   * Watching now: a heartbeat (every 30 seconds) in this minute or the
   * last, so nobody watching is missed at the turn of a minute. Peak: the
   * most in one minute so far.
   */
  async audience(eventId: string): Promise<LiveOpsAudience> {
    const now = this.clock.now();
    const since = new Date(floorToMinute(now) - MINUTE_MS);
    const [[current], [peak]] = await Promise.all([
      this.prisma.$queryRaw<{ viewers: number }[]>`
        SELECT count(DISTINCT attendee_id)::int AS viewers
        FROM attendance_minutes
        WHERE event_id = ${eventId}::uuid AND minute >= ${since}`,
      this.prisma.$queryRaw<{ viewers: number }[]>`
        SELECT coalesce(max(viewers), 0)::int AS viewers FROM (
          SELECT count(*) AS viewers FROM attendance_minutes
          WHERE event_id = ${eventId}::uuid GROUP BY minute
        ) AS per_minute`,
    ]);
    return { current: current?.viewers ?? 0, peak: peak?.viewers ?? 0 };
  }

  async rates(eventId: string, now = this.clock.now()): Promise<LiveOpsRates> {
    const since = new Date(now.getTime() - MINUTE_MS);
    const [messagesPerMinute, questionsPerMinute] = await Promise.all([
      this.prisma.chatMessage.count({
        where: { eventId, createdAt: { gt: since, lte: now } },
      }),
      this.prisma.question.count({
        where: { eventId, createdAt: { gt: since, lte: now } },
      }),
    ]);
    return { messagesPerMinute, questionsPerMinute };
  }

  private async audienceWithSeries(
    eventId: string,
    startsAt: Date,
    endsAt: Date,
    now: Date,
  ): Promise<LiveOps["audience"]> {
    const [rows, figures] = await Promise.all([
      this.prisma.$queryRaw<{ minute: Date; viewers: number }[]>`
        SELECT minute, count(*)::int AS viewers FROM attendance_minutes
        WHERE event_id = ${eventId}::uuid
        GROUP BY minute ORDER BY minute`,
      this.audience(eventId),
    ]);
    // Up to this minute: the minutes still to come are not zeros.
    const until = Math.min(endsAt.getTime(), floorToMinute(now) + MINUTE_MS);
    const { series } = summariseAudience(rows, startsAt, new Date(until));
    return {
      ...figures,
      series: series.map(({ minute, viewers }) => ({
        minute: minute.toISOString(),
        viewers,
      })),
    };
  }

  /** Every incident of the event, oldest first. */
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

function floorToMinute(date: Date): number {
  return date.getTime() - (date.getTime() % MINUTE_MS);
}
