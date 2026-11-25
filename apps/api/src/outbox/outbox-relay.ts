import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { inTraceOf } from "../observability/trace-context.js";
import { JobPublisher } from "../queues/job-publisher.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { type RelayedMessage, routeOutboxMessage } from "./outbox-routes.js";

/** Messages claimed per round. */
export const RELAY_BATCH_SIZE = 100;
/** Pause between rounds when there was nothing to relay. */
export const RELAY_IDLE_MS = 500;

/**
 * Moves committed outbox messages onto BullMQ queues (ADR-0007).
 *
 * Each round claims undispatched messages with `FOR UPDATE SKIP LOCKED`, so
 * several worker processes share the work without taking the same message,
 * publishes their jobs, and marks them dispatched in the same transaction.
 * If the process dies after publishing but before committing, the messages
 * are relayed again; their job IDs are the message IDs, so BullMQ keeps one
 * job, and every handler is idempotent anyway.
 */
@Injectable()
export class OutboxRelay {
  private running: Promise<void> | undefined;
  private stopped = true;
  private wake: (() => void) | undefined;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly publisher: JobPublisher,
    @InjectPinoLogger(OutboxRelay.name) private readonly logger: PinoLogger,
  ) {}

  /** Relays one batch. @returns how many messages were marked dispatched */
  async relayOnce(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const messages = await tx.$queryRaw<
        (RelayedMessage & { trace_context: unknown })[]
      >`
        SELECT id, type, payload, trace_context
        FROM outbox_messages
        WHERE dispatched_at IS NULL
        ORDER BY created_at, id
        LIMIT ${RELAY_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`;
      for (const message of messages) {
        // Queued in the trace of the request that wrote the message, so
        // the job continues it.
        await inTraceOf(message.trace_context, () => this.relay(message));
      }
      const dispatched = messages.map((message) => message.id);
      if (dispatched.length > 0) {
        await tx.outboxMessage.updateMany({
          where: { id: { in: dispatched } },
          data: { dispatchedAt: this.clock.now() },
        });
      }
      return dispatched.length;
    });
  }

  /** Starts relaying continuously until stop() is called. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.running = this.loop();
  }

  /** Finishes the current round, then stops (graceful shutdown, NFR-5). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.running;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let relayed = 0;
      try {
        relayed = await this.relayOnce();
      } catch (error) {
        this.logger.error({ err: error }, "Outbox relay round failed");
      }
      // A full batch means more may be waiting: go again at once.
      if (relayed < RELAY_BATCH_SIZE) {
        await this.sleep(RELAY_IDLE_MS);
      }
    }
  }

  /**
   * Publishes one message's job. A message with a malformed payload (a bug
   * in its writer) is logged and still marked dispatched: left in place it
   * would be retried every round and could crowd out every message behind
   * it. The row stays in the table for inspection.
   */
  private async relay(message: RelayedMessage): Promise<void> {
    let job;
    try {
      job = routeOutboxMessage(message);
    } catch (error) {
      this.logger.error(
        { err: error, outboxMessageId: message.id, type: message.type },
        "Outbox message has a malformed payload; not relayed",
      );
      return;
    }
    if (job !== undefined) {
      await this.publisher.publish(job);
    }
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
