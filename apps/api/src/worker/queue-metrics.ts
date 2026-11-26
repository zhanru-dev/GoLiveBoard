import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type {
  BatchObservableCallback,
  ObservableGauge,
} from "@opentelemetry/api";
import type { Queue } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { appMeter, METRICS } from "../observability/metrics.js";
import { QUEUES } from "../queues/queues.module.js";
import type { QueueName } from "../queues/queues.js";
import { CLOCK, type Clock } from "../shared/clock.js";

/** The job states counted, as BullMQ names them. */
const STATES = ["wait", "delayed", "active", "failed"] as const;

/**
 * Queue depth and the age of the oldest waiting job, per queue, and the age
 * of the oldest outbox message not yet relayed (docs/06, section 7: alert
 * when a job has waited five minutes). Read when the metrics are collected.
 */
@Injectable()
export class QueueMetrics implements OnApplicationShutdown {
  private readonly jobs: ObservableGauge;
  private readonly oldestJob: ObservableGauge;
  private readonly oldestMessage: ObservableGauge;
  private readonly observe: BatchObservableCallback;

  constructor(
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectPinoLogger(QueueMetrics.name) private readonly logger: PinoLogger,
  ) {
    const meter = appMeter();
    this.jobs = meter.createObservableGauge(METRICS.queueJobs, {
      description: "Jobs per queue and state",
    });
    this.oldestJob = meter.createObservableGauge(METRICS.queueOldestJobAge, {
      description: "Age of the oldest waiting job per queue",
      unit: "s",
    });
    this.oldestMessage = meter.createObservableGauge(
      METRICS.outboxOldestMessageAge,
      {
        description: "Age of the oldest outbox message not relayed",
        unit: "s",
      },
    );
    this.observe = async (result) => {
      const now = this.clock.now().getTime();
      for (const [name, queue] of this.queues) {
        try {
          const counts = await queue.getJobCounts(...STATES);
          for (const state of STATES) {
            result.observe(this.jobs, counts[state] ?? 0, {
              "goliveboard.queue": name,
              "goliveboard.queue.state": state,
            });
          }
          const [oldest] = await queue.getJobs(["wait"], 0, 0, true);
          result.observe(
            this.oldestJob,
            oldest === undefined
              ? 0
              : Math.max(0, now - oldest.timestamp) / 1000,
            { "goliveboard.queue": name },
          );
        } catch (error) {
          // Valkey unreachable: report nothing rather than zeros.
          this.logger.warn(
            { err: error, queue: name },
            "Queue metrics unavailable",
          );
        }
      }
      try {
        const [row] = await this.prisma.$queryRaw<{ oldest: Date | null }[]>`
          SELECT min(created_at) AS oldest FROM outbox_messages
          WHERE dispatched_at IS NULL`;
        const oldest = row?.oldest ?? null;
        result.observe(
          this.oldestMessage,
          oldest === null ? 0 : Math.max(0, now - oldest.getTime()) / 1000,
        );
      } catch (error) {
        this.logger.warn({ err: error }, "Outbox metrics unavailable");
      }
    };
    meter.addBatchObservableCallback(this.observe, [
      this.jobs,
      this.oldestJob,
      this.oldestMessage,
    ]);
  }

  onApplicationShutdown(): void {
    appMeter().removeBatchObservableCallback(this.observe, [
      this.jobs,
      this.oldestJob,
      this.oldestMessage,
    ]);
  }
}
