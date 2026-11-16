import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { WebhookFanOutJob } from "@opspilot/contracts";
import { type Job, type Queue, Worker } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { QUEUES } from "../queues/queues.module.js";
import {
  closeWithin,
  consumerConnection,
  type QueueName,
  WEBHOOK_JOBS,
  WEBHOOKS_QUEUE,
} from "../queues/queues.js";
import { WebhookFanOut } from "../webhooks/webhook-fan-out.js";
import { WebhookSender } from "../webhooks/webhook-sender.js";
import { WORKER_OPTIONS, type WorkerOptions } from "./worker-options.js";

const DELIVER_SCHEDULER_ID = "webhooks-deliver";
/** How often due deliveries are sent: the delay of a first attempt. */
export const DELIVER_EVERY_MS = 5_000;

/**
 * Webhooks (FR-RC-2): fans outbox messages out to endpoints, and sends the
 * deliveries that are due every few seconds. On a queue of its own, so a
 * slow receiver never holds up reminders or retention.
 */
@Injectable()
export class WebhooksConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private worker: Worker | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
    @Inject(WORKER_OPTIONS) private readonly options: WorkerOptions,
    private readonly fanOut: WebhookFanOut,
    private readonly sender: WebhookSender,
    @InjectPinoLogger(WebhooksConsumer.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.consume) {
      return;
    }
    await this.queues
      .get(WEBHOOKS_QUEUE)
      ?.upsertJobScheduler(
        DELIVER_SCHEDULER_ID,
        { every: DELIVER_EVERY_MS },
        { name: WEBHOOK_JOBS.deliver },
      );
    this.worker = new Worker(WEBHOOKS_QUEUE, (job) => this.process(job), {
      connection: consumerConnection(this.config),
      prefix: this.config.queues.prefix,
      concurrency: 1,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, jobName: job?.name },
        "Webhook job failed",
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
      this.logger.warn("Webhooks worker did not close in time; disconnected");
    }
  }

  /** Exposed for tests, which run jobs without a BullMQ worker. */
  async process(
    job: Pick<Job, "name"> & Partial<Pick<Job, "data">>,
  ): Promise<void> {
    switch (job.name) {
      case WEBHOOK_JOBS.fanOut: {
        const { outboxMessageId } = WebhookFanOutJob.parse(job.data);
        const created = await this.fanOut.fanOut(outboxMessageId);
        if (created > 0) {
          this.logger.info({ created, outboxMessageId }, "Webhooks fanned out");
        }
        return;
      }
      case WEBHOOK_JOBS.deliver: {
        await this.sender.sendDue();
        return;
      }
      default:
        throw new Error(`Unknown webhook job "${job.name}"`);
    }
  }
}
