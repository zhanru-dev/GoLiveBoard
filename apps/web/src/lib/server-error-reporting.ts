import * as Sentry from "@sentry/nextjs";

import { errorReportingSettings, sentryOptions } from "./error-reporting";

/**
 * Starts error reporting in the web server, if SENTRY_DSN is set.
 *
 * @returns whether reporting is on
 */
export function initServerErrorReporting(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const settings = errorReportingSettings(env);
  if (settings === null) {
    return false;
  }
  Sentry.init({
    ...sentryOptions(settings, "web-server"),
    integrations: [
      // Sentry's default ("warn") would keep the server running after an
      // unhandled rejection, in a state nobody planned for. Like Node.js
      // itself and like the API, exit; the container is restarted.
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
    ],
  });
  return true;
}
