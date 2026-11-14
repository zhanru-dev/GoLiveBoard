import {
  errorReportingSettingsFromPage,
  sentryOptions,
} from "./lib/error-reporting";
import { reportErrorsLazily } from "./lib/lazy-error-reporting";

/**
 * Starts error reporting in the browser, with the settings the server put in
 * the page. Next.js runs this before the app hydrates; if the page's head has
 * not been parsed yet, it waits until it has. The Sentry SDK itself is
 * loaded only when the first error happens (reportErrorsLazily).
 */
function start(): void {
  const settings = errorReportingSettingsFromPage(document);
  if (settings !== null) {
    reportErrorsLazily(
      window,
      sentryOptions(settings, "browser"),
      () => import("@sentry/nextjs"),
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
