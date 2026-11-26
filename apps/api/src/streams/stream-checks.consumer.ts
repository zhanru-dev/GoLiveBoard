import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { CheckStreamJob } from "@goliveboard/contracts";
import { type Job, type Queue, Worker } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { QUEUES } from "../queues/queues.module.js";
import {
  closeWithin,
  consumerConnection,
  type QueueName,
  STREAM_CHECK_JOBS,
  STREAM_CHECKS_QUEUE,
  queueTelemetry,
} from "../queues/queues.js";
import {
  WORKER_OPTIONS,
  type WorkerOptions,
} from "../worker/worker-options.js";
import { STREAM_CHECK_INTERVAL_MS } from "./domain/stream-schedule.js";
import { StreamCheckScheduler } from "./stream-check-scheduler.js";
import { StreamMonitor } from "./stream-monitor.js";

/** Checks run in parallel: each one mostly waits on the network. */
const CONCURRENCY = 10;

/**
 * Consumes the stream-checks queue and keeps the 30-second schedule
 * registered. BullMQ's job scheduler fires the `schedule` job once per
 * interval however many worker processes run.
 */
@Injectable()
export class StreamChecksConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private worker: Worker | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
    @Inject(WORKER_OPTIONS) private readonly options: WorkerOptions,
    private readonly monitor: StreamMonitor,
    private readonly scheduler: StreamCheckScheduler,
    @InjectPinoLogger(StreamChecksConsumer.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.consume) {
      return;
    }
    await this.queues
      .get(STREAM_CHECKS_QUEUE)
      ?.upsertJobScheduler(
        "stream-check-schedule",
        { every: STREAM_CHECK_INTERVAL_MS },
        { name: STREAM_CHECK_JOBS.schedule },
      );
    this.worker = new Worker(STREAM_CHECKS_QUEUE, (job) => this.process(job), {
      connection: consumerConnection(this.config),
      prefix: this.config.queues.prefix,
      telemetry: queueTelemetry(),
      concurrency: CONCURRENCY,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, jobName: job?.name },
        "Stream-check job failed",
      );
    });
  }

  /**
   * Lets running checks finish before the process exits (NFR-5), but only
   * for the grace period: a frozen Valkey would otherwise keep it alive.
   */
  async onApplicationShutdown(): Promise<void> {
    const worker = this.worker;
    if (worker === undefined) {
      return;
    }
    const clean = await closeWithin(
      () => worker.close(),
      async () => {
        void worker.close(true);
        await worker.disconnect();
      },
    );
    if (!clean) {
      this.logger.warn(
        "Stream-check worker did not close in time; disconnected",
      );
    }
  }

  /** Exposed for tests, which run jobs without a BullMQ worker. */
  async process(job: Pick<Job, "name" | "data">): Promise<void> {
    switch (job.name) {
      case STREAM_CHECK_JOBS.schedule:
        await this.scheduler.scheduleDueChecks();
        return;
      case STREAM_CHECK_JOBS.check: {
        const data = CheckStreamJob.parse(job.data);
        await this.monitor.check(data.eventId, new Date(data.slot));
        return;
      }
      default:
        throw new Error(`Unknown stream-check job "${job.name}"`);
    }
  }
}
