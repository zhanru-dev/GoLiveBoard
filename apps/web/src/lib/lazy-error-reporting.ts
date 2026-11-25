import type { BrowserOptions } from "@sentry/nextjs";

import {
  errorReportingSettingsFromPage,
  sentryOptions,
} from "./error-reporting";

/** The part of the Sentry SDK the browser needs. */
export interface ErrorReporter {
  init(options: BrowserOptions): unknown;
  captureException(error: unknown): unknown;
}

/**
 * Reports the browser's uncaught errors without loading the Sentry SDK until
 * one happens, as Sentry's own loader script does. The SDK is large: parsed
 * and run on every page it would block the main thread for hundreds of
 * milliseconds on a phone, against the public page's budget (NFR-3).
 *
 * The listeners go on at once, before the page has even been parsed: React
 * can hydrate, and an error boundary report a caught error, before
 * DOMContentLoaded, and an error event nobody heard is gone. Errors are kept
 * until the first one asks for the settings (`options`), which may wait for
 * the page; then the SDK is loaded and started, what was kept is reported,
 * and the SDK's own handlers take over from these. With no settings
 * (reporting off), what was kept is dropped and the listeners removed.
 */
export function reportErrorsLazily(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  options: () => Promise<BrowserOptions | null>,
  load: () => Promise<ErrorReporter>,
): void {
  const pending: unknown[] = [];
  let loading: Promise<void> | undefined;

  const onError = (event: ErrorEvent) => {
    keep(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    keep(event.reason);
  };

  function stopListening(): void {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  }

  async function start(): Promise<void> {
    const settings = await options();
    if (settings === null) {
      stopListening();
      pending.length = 0;
      return;
    }
    let reporter: ErrorReporter;
    try {
      reporter = await load();
    } catch {
      // The SDK could not be loaded (offline, blocked): nothing to report
      // with. Try again on the next error.
      loading = undefined;
      return;
    }
    stopListening();
    reporter.init(settings);
    for (const error of pending.splice(0)) {
      reporter.captureException(error);
    }
  }

  function keep(error: unknown): void {
    pending.push(error);
    loading ??= start();
  }

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
}

/** Resolves once the document has been parsed (its head can be read). */
export function whenParsed(
  document: Pick<Document, "readyState" | "addEventListener">,
): Promise<void> {
  if (document.readyState !== "loading") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Starts error reporting in the browser (instrumentation-client.ts): the
 * listeners at once, the settings from the page's head once it is parsed
 * and an error needs them.
 */
export function startErrorReporting(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  page: Pick<Document, "readyState" | "addEventListener" | "querySelector">,
  load: () => Promise<ErrorReporter>,
): void {
  reportErrorsLazily(
    target,
    async () => {
      await whenParsed(page);
      const settings = errorReportingSettingsFromPage(page);
      return settings === null ? null : sentryOptions(settings, "browser");
    },
    load,
  );
}
