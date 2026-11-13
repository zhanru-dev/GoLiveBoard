import { Inject, Injectable } from "@nestjs/common";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { JobPublisher } from "../queues/job-publisher.js";
import { STREAM_CHECK_JOBS, STREAM_CHECKS_QUEUE } from "../queues/queues.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import {
  isStreamCheckDue,
  slotFor,
  STREAM_CHECK_LEAD_TIME_MS,
} from "./domain/stream-schedule.js";

/** Enqueues a check for every event whose stream is due (FR-ST-2). */
@Injectable()
export class StreamCheckScheduler {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly publisher: JobPublisher,
  ) {}

  /**
   * Runs every 30 seconds. The query narrows the candidates in SQL;
   * isStreamCheckDue makes the exact decision. Job IDs name the event and
   * the slot, so a tick that runs twice enqueues each check once.
   *
   * @returns how many checks were enqueued
   */
  async scheduleDueChecks(): Promise<number> {
    const now = this.clock.now();
    const candidates = await this.prisma.event.findMany({
      where: {
        streamUrl: { not: null },
        status: { in: ["DRAFT", "CONFIGURING", "READY", "LIVE"] },
        startsAt: { lte: new Date(now.getTime() + STREAM_CHECK_LEAD_TIME_MS) },
        OR: [{ endsAt: { gt: now } }, { status: "LIVE" }],
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        streamUrl: true,
      },
    });
    const due = candidates.filter((event) => isStreamCheckDue(event, now));
    const slot = slotFor(now);
    for (const event of due) {
      await this.publisher.publish({
        queue: STREAM_CHECKS_QUEUE,
        name: STREAM_CHECK_JOBS.check,
        data: { eventId: event.id, slot: slot.toISOString() },
        jobId: `check-${event.id}-${String(slot.getTime())}`,
      });
    }
    return due.length;
  }
}
