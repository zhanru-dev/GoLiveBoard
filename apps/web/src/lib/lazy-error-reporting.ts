import type { BrowserOptions } from "@sentry/nextjs";

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
 * Until the first error only two small listeners exist. That error, and any
 * that follow while the SDK loads, are kept; once it is loaded and started,
 * they are reported, and the SDK's own handlers take over from these.
 */
export function reportErrorsLazily(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  options: BrowserOptions,
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

  function keep(error: unknown): void {
    pending.push(error);
    loading ??= load().then(
      (reporter) => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
        reporter.init(options);
        for (const error of pending.splice(0)) {
          reporter.captureException(error);
        }
      },
      () => {
        // The SDK could not be loaded (offline, blocked): nothing to report
        // with. Try again on the next error.
        loading = undefined;
      },
    );
  }

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
}
