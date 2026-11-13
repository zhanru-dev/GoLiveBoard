import { performance } from "node:perf_hooks";

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { lockEventForStreamCheck } from "../events/event-lock.queries.js";
import { SafeHttpClient } from "../net/safe-http.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import {
  CONSECUTIVE_CHECKS,
  incidentChange,
  type IncidentChange,
} from "./domain/incident-rule.js";
import { probeStream } from "./stream-probe.js";

export interface CheckOutcome {
  /** False when this slot was already checked or there is nothing to check. */
  readonly recorded: boolean;
  readonly incident: IncidentChange;
}

const SKIPPED: CheckOutcome = { recorded: false, incident: "NONE" };

/**
 * FR-ST-2: checks an event's stream, records the result and opens or
 * resolves the STREAM_UNREACHABLE incident.
 */
@Injectable()
export class StreamMonitor {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly http: SafeHttpClient,
    @InjectPinoLogger(StreamMonitor.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Checks the stream for one slot. Idempotent: the check is stored with its
   * slot, unique per event, so a job that runs twice (a retry after a crash,
   * or a scheduler tick and a relay both enqueuing it) records one check and
   * judges the incident once.
   */
  async check(eventId: string, slot: Date): Promise<CheckOutcome> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { streamUrl: true },
    });
    const url = event?.streamUrl ?? null;
    if (url === null) {
      return SKIPPED;
    }
    const started = performance.now();
    const result = await probeStream(this.http, url);
    const latencyMs = Math.round(performance.now() - started);
    const checkedAt = this.clock.now();

    const outcome = await this.prisma.$transaction(async (tx) => {
      // The event's row lock, the one transitions take (lockEvent). A check
      // is evidence for readiness, so like every other change readiness
      // reads it must not commit while a transition that already judged
      // readiness is still deciding; it waits, and lands after it. The same
      // lock judges one event's checks one at a time, so two checks that
      // finish together cannot both miss the second failure in a row.
      const locked = await lockEventForStreamCheck(tx, eventId);
      // The URL may have changed while it was fetched: that result says
      // nothing about the new URL.
      if (locked?.streamUrl !== url) {
        return SKIPPED;
      }
      const { count } = await tx.streamCheck.createMany({
        data: [{ eventId, url, slot, checkedAt, latencyMs, ...result }],
        skipDuplicates: true,
      });
      if (count === 0) {
        return SKIPPED;
      }
      return {
        recorded: true,
        incident: await this.updateIncident(tx, eventId, url, checkedAt),
      };
    });
    if (outcome.incident !== "NONE") {
      this.logger.info(
        { eventId, incident: outcome.incident },
        outcome.incident === "OPEN"
          ? "Stream unreachable: incident opened"
          : "Stream reachable again: incident resolved",
      );
    }
    return outcome;
  }

  private async updateIncident(
    tx: Prisma.TransactionClient,
    eventId: string,
    url: string,
    checkedAt: Date,
  ): Promise<IncidentChange> {
    const recent = await tx.streamCheck.findMany({
      where: { eventId, url },
      orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
      take: CONSECUTIVE_CHECKS,
      select: { ok: true },
    });
    const open = await tx.incident.findFirst({
      where: { eventId, kind: "STREAM_UNREACHABLE", resolvedAt: null },
      select: { id: true },
    });
    const change = incidentChange(recent, open !== null);
    if (change === "OPEN") {
      await tx.incident.create({
        data: { eventId, kind: "STREAM_UNREACHABLE", openedAt: checkedAt },
      });
    } else if (change === "RESOLVE" && open !== null) {
      await tx.incident.update({
        where: { id: open.id },
        data: { resolvedAt: checkedAt },
      });
    }
    return change;
  }
}
