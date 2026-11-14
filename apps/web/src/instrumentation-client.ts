import * as Sentry from "@sentry/nextjs";

import {
  errorReportingSettingsFromPage,
  sentryOptions,
} from "./lib/error-reporting";

/**
 * Starts error reporting in the browser, with the settings the server put in
 * the page. Next.js runs this before the app hydrates; if the page's head has
 * not been parsed yet, it waits until it has.
 */
function start(): void {
  const settings = errorReportingSettingsFromPage(document);
  if (settings !== null) {
    Sentry.init(sentryOptions(settings, "browser"));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
