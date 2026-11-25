import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import {
  pino,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";
import { type HttpLogger, pinoHttp } from "pino-http";

import type { AppConfig } from "../config/app-config.js";
import { API_PREFIX } from "../http/api-prefix.js";
import {
  type ErrorReporter,
  sentryReporter,
  throttleReports,
} from "./error-reporting.js";
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

/** Injection token for the request-logging middleware. */
export const HTTP_LOGGER = Symbol("HTTP_LOGGER");

/**
 * Injection token for the root logger, for code that runs outside any request:
 * connection events, timers, background work. (`PinoLogger` would attach the
 * request during which such a callback happened to be registered.)
 */
export const ROOT_LOGGER = Symbol("ROOT_LOGGER");

const HEALTH_PATH_PREFIX = `/${API_PREFIX}/health/`;

/**
 * Logs only the path: query strings can carry one-time tokens (for example in
 * email verification links), and headers carry cookies.
 */
function pathOf(url: string | undefined): string {
  return url?.split("?", 1)[0] ?? "";
}

/**
 * The trace a line was logged in, so logs and traces join up (NFR-7). Empty
 * when tracing is off or nothing is being traced.
 */
export function traceFields(): { trace_id?: string; span_id?: string } {
  const span = trace.getSpan(context.active());
  if (span === undefined) {
    return {};
  }
  const spanContext = span.spanContext();
  return isSpanContextValid(spanContext)
    ? { trace_id: spanContext.traceId, span_id: spanContext.spanId }
    : {};
}

/** pino's number for the `error` level; `fatal` is above it. */
const ERROR_LEVEL = 50;

/**
 * The error a log call carries: `logger.error({ err }, "…")`, or an error
 * logged on its own.
 */
function loggedError(args: readonly unknown[]): Error | undefined {
  const [first] = args;
  if (first instanceof Error) {
    return first;
  }
  if (typeof first === "object" && first !== null && "err" in first) {
    return first.err instanceof Error ? first.err : undefined;
  }
  return undefined;
}

function messageOf(args: readonly unknown[], error: Error): string {
  const message = args.find((arg) => typeof arg === "string");
  return typeof message === "string" ? message : error.message;
}

/** The request a request-scoped child logger is bound to (pino-http). */
function requestIdOf(logger: Logger): string | undefined {
  const { req } = logger.bindings() as { req?: { id?: unknown } };
  return typeof req?.id === "string" ? req.id : undefined;
}

/**
 * The application's one pino logger. Every log line, inside a request or not,
 * comes from it, so level, redaction and error reporting are configured in
 * one place.
 *
 * Every line at `error` or above that carries an error (`{ err }`) is also
 * reported (Sentry in production). Lines without one, such as pino-http's
 * summary of a 500 response, are not: the error behind them was logged, and
 * reported, where it was caught. Reporting follows the log level, so a level
 * above `error` silences both, and each kind of error is reported at most
 * once a minute (`throttleReports`).
 */
export function createLogger(
  config: AppConfig,
  destination?: DestinationStream,
  reporter: ErrorReporter = throttleReports(sentryReporter),
): Logger {
  const options: LoggerOptions = {
    level: config.log.level,
    redact: { paths: REDACTED_PATHS, censor: REDACTION_CENSOR },
    mixin: traceFields,
    hooks: {
      logMethod(args, method, level) {
        if (level >= ERROR_LEVEL) {
          const error = loggedError(args);
          if (error !== undefined) {
            try {
              reporter(error, {
                message: messageOf(args, error),
                requestId: requestIdOf(this),
              });
            } catch {
              // Reporting must never stop the line from being logged.
            }
          }
        }
        method.apply(this, args);
      },
    },
  };
  if (destination !== undefined) {
    return pino(options, destination);
  }
  if (config.log.format === "pretty") {
    return pino({
      ...options,
      transport: { target: "pino-pretty", options: { singleLine: true } },
    });
  }
  return pino(options);
}

/**
 * Middleware that gives each request its ID (`X-Request-Id`), binds a child
 * logger to it, and logs one line when the response finishes.
 */
export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (request, response) => {
      const id = resolveRequestId(request.headers["x-request-id"]);
      response.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
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
    // The workspace the signed-in actor works in, once SessionGuard has
    // resolved it (pino-http reads this again when the response finishes).
    customProps: (request) => {
      const { actor } = request as { actor?: { workspaceId?: unknown } };
      return typeof actor?.workspaceId === "string"
        ? { workspaceId: actor.workspaceId }
        : {};
    },
    customLogLevel: (_request, response, error) =>
      error !== undefined || response.statusCode >= 500 ? "error" : "info",
    // For a 5xx pino-http makes up an error ("failed with status code 500"),
    // and for a client that went away it passes the socket's. Neither is a
    // bug to report: the error behind a 500 was logged, and reported, where
    // it was caught. The summary line keeps only the message.
    customErrorObject: (_request, _response, error, value: object) => {
      const { err: _omitted, ...rest } = value as { err?: unknown };
      return { ...rest, responseError: error.message };
    },
    // Probes call the health endpoints every few seconds; logging them would
    // bury every other request.
    autoLogging: {
      ignore: (request) => pathOf(request.url).startsWith(HEALTH_PATH_PREFIX),
    },
  });
}
