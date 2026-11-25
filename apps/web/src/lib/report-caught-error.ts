/**
 * Reports an error that an error boundary caught. React keeps those away
 * from the window's error handlers, so the lazy Sentry reporter
 * (lazy-error-reporting.ts) would never see them; `reportError` hands the
 * error to the window as an uncaught one: it loads the SDK if it is not
 * yet, and is captured like any other uncaught error.
 *
 * An error rendered on the server reaches the browser with a `digest` and
 * its message replaced; the server has reported it already, with the real
 * message (server-error-reporting.ts), so it is not reported twice.
 */
export function reportCaughtError(
  error: unknown,
  target: { reportError?: (error: unknown) => void } = globalThis,
): void {
  const fromServer =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string";
  if (!fromServer) {
    target.reportError?.(error);
  }
}
