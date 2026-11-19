import {
  type DynamicModule,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Logger } from "pino";

import { flushErrorReports } from "./error-reporting.js";
import { stopTelemetry } from "./telemetry.js";
import { createHttpLogger, HTTP_LOGGER, ROOT_LOGGER } from "./logger.js";

/**
 * Sends spans and error reports still queued when the process stops, such
 * as the report for the error that is stopping it.
 */
@Injectable()
export class ErrorReportFlusher implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Side by side, each with its own time limit: a collector that does not
    // answer must not hold back the error report about why we stop.
    await Promise.all([stopTelemetry(), flushErrorReports()]);
  }
}

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
        ErrorReportFlusher,
      ],
      exports: [ROOT_LOGGER, HTTP_LOGGER],
    };
  }
}
