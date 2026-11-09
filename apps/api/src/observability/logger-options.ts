import type { Options } from "pino-http";

import type { AppConfig } from "../config/app-config.js";
import { API_PREFIX } from "../http/api-prefix.js";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id.js";

/**
 * Keys whose values never reach the logs, wherever they appear at the top
 * level or one level down (`password`, `user.email`, …).
 */
const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "email",
];
export const REDACTED_PATHS = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
]);
export const REDACTION_CENSOR = "[Redacted]";

const HEALTH_PATH_PREFIX = `/${API_PREFIX}/health/`;

/**
 * Logs only the path: query strings can carry one-time tokens (for example in
 * email verification links), and headers carry cookies.
 */
function pathOf(url: string | undefined): string {
  return url?.split("?", 1)[0] ?? "";
}

/** Request and response logging for every HTTP request (pino-http). */
export function createHttpLoggerOptions(config: AppConfig): Options {
  return {
    level: config.log.level,
    genReqId: (request, response) => {
      const id = resolveRequestId(request.headers["x-request-id"]);
      response.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    redact: { paths: REDACTED_PATHS, censor: REDACTION_CENSOR },
    serializers: {
      // pino-http hands serializers a plain copy of the request, not the
      // request itself.
      req: (request: { id?: unknown; method?: string; url?: string }) => ({
        id: request.id,
        method: request.method,
        path: pathOf(request.url),
      }),
      res: (response: { statusCode: number }) => ({
        statusCode: response.statusCode,
      }),
    },
    customLogLevel: (_request, response, error) =>
      error !== undefined || response.statusCode >= 500 ? "error" : "info",
    // Probes call the health endpoints every few seconds; logging them would
    // bury every other request.
    autoLogging: {
      ignore: (request) => pathOf(request.url).startsWith(HEALTH_PATH_PREFIX),
    },
    ...(config.log.format === "pretty" && {
      transport: { target: "pino-pretty", options: { singleLine: true } },
    }),
  };
}
