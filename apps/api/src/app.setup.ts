import type { NestApplicationOptions } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";

import { API_PREFIX } from "./http/api-prefix.js";

/** Options for `NestFactory.create`, shared by the server and the tests. */
export const APP_OPTIONS = {
  // Collect startup logs until the pino logger is attached below.
  bufferLogs: true,
  // The JSON parser is registered in AppModule, after the request logger.
  bodyParser: false,
} as const satisfies NestApplicationOptions;

/**
 * Settings applied to the application object rather than declared in modules.
 * The server and the integration tests both call this, so tests exercise the
 * same HTTP behaviour that runs in production.
 */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // Security headers such as `X-Content-Type-Options: nosniff`; also removes
  // `X-Powered-By`, which only helps attackers fingerprint the server.
  app.use(helmet());
}
