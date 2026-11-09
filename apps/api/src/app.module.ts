import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { json } from "express";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";

import type { AppConfig } from "./config/app-config.js";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { createValidationPipe } from "./http/request-validation.js";
import { createHttpLoggerOptions } from "./observability/logger-options.js";

/**
 * Largest accepted JSON body. Our requests are small forms; a low limit stops
 * a client from making the server parse megabytes of JSON.
 */
export const JSON_BODY_LIMIT = "100kb";

export interface AppModuleOptions {
  /** Where logs are written; tests pass a stream to inspect them. */
  readonly logDestination?: DestinationStream;
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(
    config: AppConfig,
    options: AppModuleOptions = {},
  ): DynamicModule {
    const httpLoggerOptions = createHttpLoggerOptions(config);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp:
            options.logDestination === undefined
              ? httpLoggerOptions
              : [httpLoggerOptions, options.logDestination],
        }),
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }

  /**
   * The JSON body parser runs as module middleware, after the request logger,
   * so a request with a malformed or oversized body still gets a request ID and
   * a log line. The app is created with `bodyParser: false` for this reason.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(json({ limit: JSON_BODY_LIMIT })).forRoutes("{*splat}");
  }
}
