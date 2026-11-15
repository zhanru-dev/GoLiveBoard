import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";

import { AttendeeMail } from "../attendees/attendee-mail.js";
import { ReminderSender } from "../attendees/reminder-sender.js";
import { RetentionJob } from "../attendees/retention-job.js";
import type { AppConfig } from "../config/app-config.js";
import { ConfigModule } from "../config/config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MaintenanceConsumer } from "./maintenance.consumer.js";
import { DemoModule } from "../demo/demo.module.js";
import { NetModule } from "../net/net.module.js";
import type { SafeHttpOptions } from "../net/safe-http.js";
import { RealtimeSignalsModule } from "../live/realtime-signals.js";
import { MailModule } from "../mail/mail.module.js";
import { createLogger } from "../observability/logger.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { OutboxRelay } from "../outbox/outbox-relay.js";
import { QueuesModule } from "../queues/queues.module.js";
import { type Clock, ClockModule } from "../shared/clock.js";
import { StreamCheckScheduler } from "../streams/stream-check-scheduler.js";
import { StreamChecksConsumer } from "../streams/stream-checks.consumer.js";
import { StreamMonitor } from "../streams/stream-monitor.js";
import { RelayRunner } from "./relay-runner.js";
import { WORKER_OPTIONS, type WorkerOptions } from "./worker-options.js";

export interface WorkerModuleOptions {
  readonly logDestination?: DestinationStream;
  readonly clock?: Clock;
  readonly safeHttp?: SafeHttpOptions;
  readonly worker?: WorkerOptions;
}

/**
 * The worker process (ADR-0002): the outbox relay and the queue consumers,
 * with no HTTP server. It shares modules with the API but starts from its
 * own entry point, src/worker.ts.
 */
@Module({})
export class WorkerModule {
  static forRoot(
    config: AppConfig,
    options: WorkerModuleOptions = {},
  ): DynamicModule {
    const logger = createLogger(config, options.logDestination);
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        ObservabilityModule.forRoot(logger),
        ClockModule.forRoot(options.clock),
        LoggerModule.forRoot({ pinoHttp: { logger }, useExisting: true }),
        NetModule.forRoot(options.safeHttp),
        DatabaseModule,
        DemoModule,
        MailModule,
        QueuesModule,
        RealtimeSignalsModule,
      ],
      providers: [
        {
          provide: WORKER_OPTIONS,
          useValue: options.worker ?? { consume: true },
        },
        OutboxRelay,
        RelayRunner,
        StreamMonitor,
        StreamCheckScheduler,
        StreamChecksConsumer,
        AttendeeMail,
        ReminderSender,
        RetentionJob,
        MaintenanceConsumer,
      ],
    };
  }
}
