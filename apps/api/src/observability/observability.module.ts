import { type DynamicModule, Module } from "@nestjs/common";
import type { Logger } from "pino";

import { createHttpLogger, HTTP_LOGGER, ROOT_LOGGER } from "./logger.js";

/** Makes the application's logger injectable everywhere. */
@Module({})
export class ObservabilityModule {
  static forRoot(logger: Logger): DynamicModule {
    return {
      module: ObservabilityModule,
      global: true,
      providers: [
        { provide: ROOT_LOGGER, useValue: logger },
        { provide: HTTP_LOGGER, useValue: createHttpLogger(logger) },
      ],
      exports: [ROOT_LOGGER, HTTP_LOGGER],
    };
  }
}
