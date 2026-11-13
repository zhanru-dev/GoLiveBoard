import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";

import { AuthModule } from "./auth/auth.module.js";
import type { AppConfig } from "./config/app-config.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { createValidationPipe } from "./http/request-validation.js";
import { createLogger } from "./observability/logger.js";
import { type Clock, ClockModule } from "./shared/clock.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";

export interface AppModuleOptions {
  /** Where logs are written; tests pass a stream to inspect them. */
  readonly logDestination?: DestinationStream;
  /** The current time; tests pass a clock they control. */
  readonly clock?: Clock;
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
        // `useExisting`: the request-logging middleware is mounted by
        // configureApp, ahead of routing; nestjs-pino only makes each request's
        // logger available to `PinoLogger` and uses ours for everything else.
        LoggerModule.forRoot({ pinoHttp: { logger }, useExisting: true }),
        HealthModule,
        AuthModule,
        WorkspacesModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }
}
