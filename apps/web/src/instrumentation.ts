import * as Sentry from "@sentry/nextjs";

import { errorReportingSettings, sentryOptions } from "./lib/error-reporting";

/**
 * Runs once when the web server starts (docs/02, section 7.9). Reporting is
 * on only when SENTRY_DSN is set.
 */
export function register(): void {
  // Pages, route handlers and the proxy all run on Node.js.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const settings = errorReportingSettings();
  if (settings !== null) {
    Sentry.init(sentryOptions(settings, "web-server"));
  }
}

/** Errors thrown while rendering a page or answering a route handler. */
export const onRequestError = Sentry.captureRequestError;
