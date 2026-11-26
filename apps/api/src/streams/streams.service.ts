import { Inject, Injectable } from "@nestjs/common";
import type {
  EventDetail,
  Incident,
  PageQuery,
  StreamCheckPage,
  StreamCheckRequestedPayload,
} from "@goliveboard/contracts";
import { z } from "zod";

import { auditableUrl } from "../audit/redact.js";
import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { lockWritableEvent } from "../events/event-lock.queries.js";
import { assertNotDemoStream } from "../demo/demo-workspace.js";
import { EventsService } from "../events/events.service.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { decodeCursor, encodeCursor } from "../http/cursor.js";
import { SafeHttpClient, SafeHttpError } from "../net/safe-http.js";
import { writeOutbox } from "../outbox/outbox.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

const CheckPosition = z.object({ checkedAt: z.iso.datetime(), id: z.uuid() });

/** FR-ST-1 and FR-ST-2, as staff see them. */
@Injectable()
export class StreamsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly http: SafeHttpClient,
    private readonly events: EventsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Sets the stream URL and asks the worker to check it at once, so Launch
   * Control shows a result within seconds instead of at the next scheduled
   * check. The host must resolve only to public addresses (SSRF); the
   * worker checks again on every fetch, because DNS answers can change.
   */
  async setStream(
    actor: Actor,
    eventId: string,
    url: string,
  ): Promise<EventDetail> {
    assertNotDemoStream(actor.workspaceId);
    await this.assertFetchable(url);
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const before = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { streamUrl: true },
      });
      const now = this.clock.now();
      await tx.event.update({
        where: { id: eventId },
        data: { streamUrl: url, version: { increment: 1 }, updatedAt: now },
      });
      await recordAudit(tx, actor, {
        action: "event.stream_set",
        targetType: "event",
        targetId: eventId,
        eventId,
        // Without credentials or the query string: tokens live there.
        before: { streamUrl: auditableUrl(before.streamUrl) },
        after: { streamUrl: auditableUrl(url) },
      });
      await this.requestCheckIn(tx, actor, eventId, now);
      return this.events.getWith(tx, actor, eventId);
    });
  }

  /**
   * "Check now". Readiness needs a successful check under 5 minutes old,
   * and scheduled checks only start an hour before the event, so staff can
   * ask for one whenever they want to move the event to READY.
   */
  async requestCheck(actor: Actor, eventId: string): Promise<void> {
    // Only after the event is known to be the actor's: otherwise anyone who
    // learned an event ID could use up its allowance from another workspace.
    await this.assertEventVisible(actor, eventId);
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.streamCheckPerEvent,
      `${actor.workspaceId}:${eventId}`,
    );
    await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { streamUrl: true },
      });
      if (event.streamUrl === null) {
        throw new DomainError("STREAM_NOT_SET");
      }
      await this.requestCheckIn(tx, actor, eventId, this.clock.now());
    });
  }

  /** Most recent first, cursor-paginated. */
  async listChecks(
    actor: Actor,
    eventId: string,
    query: PageQuery,
  ): Promise<StreamCheckPage> {
    await this.assertEventVisible(actor, eventId);
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, CheckPosition);
    const rows = await this.prisma.streamCheck.findMany({
      where: {
        eventId,
        ...(after !== undefined && {
          OR: [
            { checkedAt: { lt: new Date(after.checkedAt) } },
            { checkedAt: new Date(after.checkedAt), id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        url: row.url,
        checkedAt: row.checkedAt.toISOString(),
        ok: row.ok,
        httpStatus: row.httpStatus,
        latencyMs: row.latencyMs,
        failure: row.failure,
      })),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              checkedAt: last.checkedAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** Every incident of the event, the most recently opened first. */
  async listIncidents(actor: Actor, eventId: string): Promise<Incident[]> {
    await this.assertEventVisible(actor, eventId);
    const rows = await this.prisma.incident.findMany({
      where: { eventId },
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }

  private async requestCheckIn(
    tx: Prisma.TransactionClient,
    actor: Actor,
    eventId: string,
    now: Date,
  ): Promise<void> {
    const payload: StreamCheckRequestedPayload = {
      eventId,
      requestedAt: now.toISOString(),
    };
    await writeOutbox(tx, {
      workspaceId: actor.workspaceId,
      type: "stream.check_requested",
      payload,
    });
  }

  private async assertFetchable(url: string): Promise<void> {
    try {
      await this.http.assertFetchable(url);
    } catch (error) {
      if (!(error instanceof SafeHttpError)) {
        throw error;
      }
      throw new DomainError("VALIDATION_FAILED", {
        errors: [
          {
            path: "url",
            code: error.reason.toLowerCase(),
            message: error.message,
          },
        ],
      });
    }
  }

  private async assertEventVisible(actor: Actor, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
  }
}
