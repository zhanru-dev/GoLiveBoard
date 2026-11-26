import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { TriageRequestedPayload } from "@goliveboard/contracts";
import { type Job, type Queue, Worker } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { QUEUES } from "../queues/queues.module.js";
import {
  closeWithin,
  consumerConnection,
  type QueueName,
  TRIAGE_JOBS,
  TRIAGE_QUEUE,
  queueTelemetry,
} from "../queues/queues.js";
import { TriageRunner } from "../triage/triage-runner.js";
import { WORKER_OPTIONS, type WorkerOptions } from "./worker-options.js";

const SWEEP_SCHEDULER_ID = "triage-sweep";
const SWEEP_EVERY_MS = 60_000;

/**
 * AI question triage (FR-RN-6): runs requested runs, a few at once (each
 * mostly waits for the model), and sweeps up runs a worker left behind.
 */
@Injectable()
export class TriageConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private worker: Worker | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
    @Inject(WORKER_OPTIONS) private readonly options: WorkerOptions,
    private readonly runner: TriageRunner,
    @InjectPinoLogger(TriageConsumer.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.consume) {
      return;
    }
    await this.queues
      .get(TRIAGE_QUEUE)
      ?.upsertJobScheduler(
        SWEEP_SCHEDULER_ID,
        { every: SWEEP_EVERY_MS },
        { name: TRIAGE_JOBS.sweep },
      );
    this.worker = new Worker(TRIAGE_QUEUE, (job) => this.process(job), {
      connection: consumerConnection(this.config),
      prefix: this.config.queues.prefix,
      telemetry: queueTelemetry(),
      concurrency: 4,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, jobName: job?.name },
        "Triage job failed",
      );
    });
  }

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
      this.logger.warn("Triage worker did not close in time; disconnected");
    }
  }

  /** Exposed for tests, which run jobs without a BullMQ worker. */
  async process(
    job: Pick<Job, "name"> & Partial<Pick<Job, "data">>,
  ): Promise<void> {
    switch (job.name) {
      case TRIAGE_JOBS.run: {
        const { runId } = TriageRequestedPayload.parse(job.data);
        await this.runner.run(runId);
        return;
      }
      case TRIAGE_JOBS.sweep: {
        const closed = await this.runner.sweep();
        if (closed > 0) {
          this.logger.warn({ closed }, "Closed unfinished triage runs");
        }
        return;
      }
      default:
        throw new Error(`Unknown triage job "${job.name}"`);
    }
  }
}
