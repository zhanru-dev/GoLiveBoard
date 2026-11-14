import { describe, expect, it, vi } from "vitest";

import { type ErrorReporter, reportErrorsLazily } from "./lazy-error-reporting";

const OPTIONS = { dsn: "https://public@sentry.example/1" };

function setUp(load = vi.fn<() => Promise<ErrorReporter>>()) {
  const target = new EventTarget() as unknown as Window;
  const reporter = { init: vi.fn(), captureException: vi.fn() };
  load.mockResolvedValue(reporter);
  reportErrorsLazily(target, OPTIONS, load);
  const fail = (error: Error) =>
    target.dispatchEvent(new ErrorEvent("error", { error }));
  return { target, reporter, load, fail };
}

describe("reportErrorsLazily", () => {
  it("loads nothing until an error happens", () => {
    const { load } = setUp();

    expect(load).not.toHaveBeenCalled();
  });

  it("loads the SDK once on the first error, then reports every error kept meanwhile", async () => {
    const { reporter, load, fail } = setUp();
    const first = new Error("first");
    const second = new Error("second");

    fail(first);
    fail(second);

    await vi.waitFor(() => {
      expect(reporter.captureException).toHaveBeenCalledTimes(2);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(reporter.init).toHaveBeenCalledWith(OPTIONS);
    expect(reporter.captureException.mock.calls).toEqual([[first], [second]]);
  });

  it("reports an unhandled promise rejection too", async () => {
    const { target, reporter } = setUp();
    const reason = new Error("rejected");
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: reason });

    target.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(reporter.captureException).toHaveBeenCalledWith(reason);
    });
  });

  it("leaves later errors to the SDK's own handlers, so none is reported twice", async () => {
    const { reporter, fail } = setUp();
    fail(new Error("first"));
    await vi.waitFor(() => {
      expect(reporter.init).toHaveBeenCalled();
    });

    fail(new Error("later"));
    await Promise.resolve();

    expect(reporter.captureException).toHaveBeenCalledTimes(1);
  });

  it("tries again on the next error when the SDK could not be loaded", async () => {
    const load = vi.fn<() => Promise<ErrorReporter>>();
    const { reporter, fail } = setUp(load);
    load.mockRejectedValueOnce(new Error("offline"));

    fail(new Error("first"));
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    fail(new Error("second"));

    await vi.waitFor(() => {
      expect(reporter.captureException).toHaveBeenCalledTimes(2);
    });
  });
});
