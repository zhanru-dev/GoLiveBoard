import type { NestApplicationOptions } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import type { HttpLogger } from "pino-http";

import { APP_CONFIG, type AppConfig } from "./config/app-config.js";
import { API_PREFIX } from "./http/api-prefix.js";
import { RealtimeGateway } from "./live/realtime.gateway.js";
import { VALKEY_CLIENT, waitForValkey } from "./valkey/valkey.js";
import { HTTP_LOGGER } from "./observability/logger.js";

/**
 * Largest accepted JSON body. Our requests are small forms; a low limit stops
 * a client from making the server parse megabytes of JSON.
 */
export const JSON_BODY_LIMIT = "100kb";

function noStore(_request: Request, response: Response, next: NextFunction) {
  response.setHeader("Cache-Control", "no-store");
  next();
}

/** Options for `NestFactory.create`, shared by the server and the tests. */
export const APP_OPTIONS = {
  // Collect startup logs until the pino logger is attached below.
  bufferLogs: true,
  // configureApp registers the JSON parser itself, after the request logger,
  // and no other parser: the API accepts JSON only.
  bodyParser: false,
} as const satisfies NestApplicationOptions;

/**
 * Settings applied to the application object rather than declared in modules.
 * The server and the integration tests both call this, so tests exercise the
 * same HTTP behaviour that runs in production.
 *
 * Order matters: Express runs middleware in the order it is added, and Nest
 * adds its routes later, during `init()`.
 */
export function configureApp(app: NestExpressApplication): void {
  // First, so every request gets an ID and a log line, including one that
  // fails body parsing or routing (for example a malformed URL).
  app.use(app.get<HttpLogger>(HTTP_LOGGER));
  app.set("trust proxy", app.get<AppConfig>(APP_CONFIG).api.trustProxyHops);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // Security headers such as `X-Content-Type-Options: nosniff`; also removes
  // `X-Powered-By`, which only helps attackers fingerprint the server.
  app.use(helmet());
  // API responses are personal or change constantly; no cache may keep them.
  app.use(noStore);
  app.use(cookieParser());
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  // Socket.IO on /realtime, beside the routes (docs/04, section 4).
  app.get(RealtimeGateway).attach(app.getHttpServer());
}

/** How long the API waits for Valkey before it listens regardless. */
export const VALKEY_WAIT_MS = 30_000;

/**
 * Listens once Valkey is connected (waitForValkey), so the first requests
 * are not refused by the rules that fail closed. If Valkey is still not
 * there after VALKEY_WAIT_MS, it listens anyway: readiness then reports
 * Valkey down (the proxy and the alerts see it), which says more than an
 * API that never starts.
 */
export async function listenWhenReady(
  app: Pick<NestExpressApplication, "get" | "listen">,
  port: number,
  host: string,
  waitMs = VALKEY_WAIT_MS,
): Promise<void> {
  if (!(await waitForValkey(app.get(VALKEY_CLIENT), waitMs))) {
    app
      .get(Logger)
      .warn(
        `Valkey not connected after ${String(waitMs)} ms; listening anyway (readiness reports it)`,
      );
  }
  await app.listen(port, host);
}
