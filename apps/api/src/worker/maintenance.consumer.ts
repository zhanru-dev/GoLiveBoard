import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { DemoEventsDeletedPayload } from "@opspilot/contracts";
import { type Job, type Queue, Worker } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { QUEUES } from "../queues/queues.module.js";
import {
  closeWithin,
  consumerConnection,
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  type QueueName,
} from "../queues/queues.js";
import {
  WORKER_OPTIONS,
  type WorkerOptions,
} from "../worker/worker-options.js";
import { ReminderSender } from "../attendees/reminder-sender.js";
import { RetentionJob } from "../attendees/retention-job.js";
import { DemoSeeder } from "../demo/demo-seeder.js";

export const DEMO_RESET_SCHEDULER_ID = "demo-reset";
export const FILE_PURGE_SCHEDULER_ID = "file-purge";

export const REMINDERS_SCHEDULER_ID = "reminders";
export const RETENTION_SCHEDULER_ID = "retention";

/** How often recorded file purges are swept. */
export const FILE_PURGE_EVERY_MS = 5 * 60 * 1000;

/** How often due reminders are looked for (FR-AD-5). */
export const REMINDERS_EVERY_MS = 60 * 1000;

/** The daily retention job (FR-AD-6), after the demo reset. */
export const RETENTION_SCHEDULE = {
  pattern: "0 4 * * *",
  tz: "Europe/London",
} as const;

/**
 * Every night at 03:00 UK time (docs/06, section 10). The time zone makes
 * BullMQ follow British Summer Time, so it is 03:00 on the clock all year.
 */
export const DEMO_RESET_SCHEDULE = {
  pattern: "0 3 * * *",
  tz: "Europe/London",
} as const;

/**
 * Keeps the nightly demo reset scheduled while demo mode is on, and runs it.
 * BullMQ's job scheduler fires once per night however many workers run; with
 * demo mode off the schedule is removed, so a later deployment without demo
 * mode never resets anything. In every deployment it also keeps scheduled
 * the sweep of recorded file purges (every 5 minutes), reminders (every
 * minute) and the daily retention job.
 */
@Injectable()
export class MaintenanceConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private worker: Worker | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUES) private readonly queues: ReadonlyMap<QueueName, Queue>,
    @Inject(WORKER_OPTIONS) private readonly options: WorkerOptions,
    private readonly seeder: DemoSeeder,
    private readonly reminders: ReminderSender,
    private readonly retention: RetentionJob,
    @InjectPinoLogger(MaintenanceConsumer.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.consume) {
      return;
    }
    const queue = this.queues.get(MAINTENANCE_QUEUE);
    // Also with demo mode off: purges recorded before it was switched off
    // still have files to delete.
    await queue?.upsertJobScheduler(
      FILE_PURGE_SCHEDULER_ID,
      { every: FILE_PURGE_EVERY_MS },
      { name: MAINTENANCE_JOBS.filePurge },
    );
    await queue?.upsertJobScheduler(
      REMINDERS_SCHEDULER_ID,
      { every: REMINDERS_EVERY_MS },
      { name: MAINTENANCE_JOBS.reminders },
    );
    await queue?.upsertJobScheduler(
      RETENTION_SCHEDULER_ID,
      RETENTION_SCHEDULE,
      {
        name: MAINTENANCE_JOBS.retention,
      },
    );
    if (this.config.demo.enabled) {
      await queue?.upsertJobScheduler(
        DEMO_RESET_SCHEDULER_ID,
        DEMO_RESET_SCHEDULE,
        { name: MAINTENANCE_JOBS.demoReset },
      );
    } else {
      await queue?.removeJobScheduler(DEMO_RESET_SCHEDULER_ID);
    }
    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.process(job), {
      connection: consumerConnection(this.config),
      prefix: this.config.queues.prefix,
      concurrency: 1,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, jobName: job?.name },
        "Maintenance job failed",
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
      this.logger.warn(
        "Maintenance worker did not close in time; disconnected",
      );
    }
  }

  /** Exposed for tests, which run jobs without a BullMQ worker. */
  async process(
    job: Pick<Job, "name"> & Partial<Pick<Job, "data">>,
  ): Promise<void> {
    switch (job.name) {
      case MAINTENANCE_JOBS.demoReset: {
        // A reset queued before demo mode was switched off must not run.
        if (!this.config.demo.enabled) {
          return;
        }
        const removedEvents = await this.seeder.reset();
        this.logger.info({ removedEvents }, "Demo workspace reset");
        return;
      }
      case MAINTENANCE_JOBS.filePurge: {
        const { purged, failed } = await this.seeder.purgeDueFiles();
        if (purged > 0 || failed) {
          this.logger.info({ purged, failed }, "Swept recorded file purges");
        }
        return;
      }
      case MAINTENANCE_JOBS.reminders: {
        const sent = await this.reminders.sendDue();
        if (sent > 0) {
          this.logger.info({ sent }, "Reminders sent");
        }
        return;
      }
      case MAINTENANCE_JOBS.retention: {
        const outcome = await this.retention.run();
        this.logger.info(outcome, "Retention job finished");
        return;
      }
      case MAINTENANCE_JOBS.legacyDemoPurgeFiles: {
        // Queued by an earlier build, which purged here and gave up after
        // its last retry. Recorded instead, the sweep keeps trying.
        const { eventIds } = DemoEventsDeletedPayload.parse(job.data);
        await this.seeder.recordFilePurges(eventIds);
        return;
      }
      default:
        throw new Error(`Unknown maintenance job "${job.name}"`);
    }
  }
}
