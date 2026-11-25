import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

import type { AppConfig } from "../config/app-config.js";

/** Which process is reporting, as a tag on every event. */
export type ProcessName = "api" | "worker";

/** What is known about a logged error besides the error itself. */
export interface ErrorContext {
  /** The log line's message, e.g. "Outbox relay round failed". */
  readonly message: string;
  /** The request the error happened in, if any (`X-Request-Id`). */
  readonly requestId?: string;
}

/**
 * Receives every error the application logs. The logger calls it, so an
 * error is reported wherever it is logged, once, with no reporting code at
 * each call site.
 */
export type ErrorReporter = (error: Error, context: ErrorContext) => void;

/**
 * Sends an error to Sentry. Before `initErrorReporting` (and when no DSN is
 * configured) Sentry has no client, and this does nothing.
 */
export const sentryReporter: ErrorReporter = (error, context) => {
  Sentry.withScope((scope) => {
    if (context.requestId !== undefined) {
      scope.setTag("request_id", context.requestId);
    }
    scope.setContext("log", { message: context.message });
    Sentry.captureException(error);
  });
};

/** How long the same error is not reported again. */
export const REPORT_THROTTLE_MS = 60_000;

/** Bounds the memory a burst of different errors can take. */
const THROTTLE_MAX_KEYS = 1000;

/**
 * Reports each kind of error (same log message, error name and error
 * message) at most once per window. While Valkey or the database is down,
 * every reconnection logs the same error; without this, an outage would send
 * hundreds of identical events a minute and use up the error budget just as
 * it is needed. Sentry groups repeats into one issue anyway.
 */
export function throttleReports(
  reporter: ErrorReporter,
  now: () => number = Date.now,
  windowMs = REPORT_THROTTLE_MS,
): ErrorReporter {
  const lastReported = new Map<string, number>();
  return (error, context) => {
    const key = [context.message, error.name, error.message].join("\u0000");
    const time = now();
    const last = lastReported.get(key);
    if (last !== undefined && time - last < windowMs) {
      return;
    }
    if (lastReported.size >= THROTTLE_MAX_KEYS) {
      for (const [staleKey, reportedAt] of lastReported) {
        if (time - reportedAt >= windowMs) {
          lastReported.delete(staleKey);
        }
      }
      if (lastReported.size >= THROTTLE_MAX_KEYS) {
        lastReported.clear();
      }
    }
    lastReported.set(key, time);
    reporter(error, context);
  };
}

/**
 * Waits for queued events to be sent, at shutdown.
 *
 * @returns whether they were sent in time (true when reporting is off)
 */
export async function flushErrorReports(timeoutMs = 2000): Promise<boolean> {
  if (Sentry.getClient() === undefined) {
    return true;
  }
  return Sentry.flush(timeoutMs);
}

/**
 * Starts Sentry for this process when a DSN is configured (docs/02,
 * section 7.9). Errors only: traces are OpenTelemetry's (ADR-0011), and
 * Sentry registers no tracer provider of its own (`enableOpenTelemetrySetup`
 * is off by default in @sentry/node).
 *
 * Nothing personal leaves the process: no collected request data, user
 * details or local variables, no breadcrumbs (they would carry URLs and log
 * lines), and `scrubEvent` removes the same again in case a default changes.
 *
 * @returns whether reporting is on
 */
export function initErrorReporting(
  config: AppConfig,
  processName: ProcessName,
): boolean {
  const { dsn, environment, release } = config.errorReporting;
  if (dsn === undefined) {
    return false;
  }
  Sentry.init({
    dsn,
    environment,
    release,
    // Collect nothing that could identify a person or carry a secret.
    // Sentry's defaults collect all of it, local variables included.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    maxBreadcrumbs: 0,
    initialScope: { tags: { process: processName } },
    beforeSend: scrubEvent,
    integrations: [
      // Sentry's default ("warn") would keep the process running after an
      // unhandled rejection, in a state nobody planned for. Like Node.js
      // itself, exit; the container is restarted.
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
    ],
  });
  return true;
}

/**
 * Removes what could identify a person or carry a secret: cookies, headers,
 * query strings (one-time tokens travel in some), bodies, user details and
 * the values of local variables in stack frames.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request } = event;
  if (request !== undefined) {
    event.request = {
      method: request.method,
      url: request.url?.split("?", 1)[0],
    };
  }
  delete event.user;
  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  return event;
}
