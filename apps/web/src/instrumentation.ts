import * as Sentry from "@sentry/nextjs";

/**
 * Runs once when the web server starts (docs/02, section 7.9). Reporting is
 * on only when SENTRY_DSN is set.
 */
export async function register(): Promise<void> {
  // Pages, route handlers and the proxy all run on Node.js. This file is
  // also bundled for the edge runtime, whose Sentry lacks what the server
  // set-up uses, so that is imported only here.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { initServerErrorReporting } =
    await import("./lib/server-error-reporting");
  initServerErrorReporting();
}

/** Errors thrown while rendering a page or answering a route handler. */
export const onRequestError = Sentry.captureRequestError;
