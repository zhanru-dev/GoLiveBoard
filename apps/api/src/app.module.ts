import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";

import { AuditModule } from "./audit/audit.module.js";
import { LiveOpsModule } from "./live-ops/live-ops.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { AttendeesModule } from "./attendees/attendees.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { AuthModule } from "./auth/auth.module.js";
import type { AppConfig } from "./config/app-config.js";
import { ConfigModule } from "./config/config.module.js";
import { EventsModule } from "./events/events.module.js";
import { LaunchControlModule } from "./launch-control/launch-control.module.js";
import { LiveModule } from "./live/live.module.js";
import { NetModule } from "./net/net.module.js";
import type { SafeHttpOptions } from "./net/safe-http.js";
import { StreamsModule } from "./streams/streams.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { createValidationPipe } from "./http/request-validation.js";
import { createLogger } from "./observability/logger.js";
import { type Clock, ClockModule } from "./shared/clock.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";

export interface AppModuleOptions {
  /** Where logs are written; tests pass a stream to inspect them. */
  readonly logDestination?: DestinationStream;
  /** The current time; tests pass a clock they control. */
  readonly clock?: Clock;
  /** DNS and address rules for outbound requests; tests map test hosts. */
  readonly safeHttp?: SafeHttpOptions;
}

@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    options: AppModuleOptions = {},
  ): DynamicModule {
    const logger = createLogger(config, options.logDestination);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ObservabilityModule.forRoot(logger),
        ClockModule.forRoot(options.clock),
        NetModule.forRoot(options.safeHttp),
        // `useExisting`: the request-logging middleware is mounted by
        // configureApp, ahead of routing; nestjs-pino only makes each request's
        // logger available to `PinoLogger` and uses ours for everything else.
        LoggerModule.forRoot({ pinoHttp: { logger }, useExisting: true }),
        HealthModule,
        AuthModule,
        WorkspacesModule,
        EventsModule,
        LaunchControlModule,
        StreamsModule,
        AssetsModule,
        AttendeesModule,
        LiveModule,
        AuditModule,
        LiveOpsModule,
        ReportsModule,
        WebhooksModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }
}
