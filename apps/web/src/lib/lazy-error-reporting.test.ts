import { describe, expect, it, vi } from "vitest";

import {
  type ErrorReporter,
  reportErrorsLazily,
  startErrorReporting,
  whenParsed,
} from "./lazy-error-reporting";

const OPTIONS = { dsn: "https://public@sentry.example/1" };

function setUp(load = vi.fn<() => Promise<ErrorReporter>>()) {
  const target = new EventTarget() as unknown as Window;
  const reporter = { init: vi.fn(), captureException: vi.fn() };
  load.mockResolvedValue(reporter);
  reportErrorsLazily(target, () => Promise.resolve(OPTIONS), load);
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

  it("keeps an error raised while the page is still loading, and reports it once the page can be read", async () => {
    // A page still being parsed: an error boundary reports during the first
    // render, before DOMContentLoaded.
    const page = new EventTarget() as unknown as Document & {
      readyState: DocumentReadyState;
    };
    Object.defineProperty(page, "readyState", {
      value: "loading",
      writable: true,
    });
    const target = new EventTarget() as unknown as Window;
    const reporter = { init: vi.fn(), captureException: vi.fn() };
    const load = vi.fn(() => Promise.resolve(reporter));
    reportErrorsLazily(
      target,
      async () => {
        await whenParsed(page);
        return OPTIONS;
      },
      load,
    );
    const caught = new Error("The chat could not render");

    target.dispatchEvent(new ErrorEvent("error", { error: caught }));
    // Long enough for any promise chain: nothing loads before the page is.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(load).not.toHaveBeenCalled();

    page.readyState = "interactive";
    page.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => {
      expect(reporter.captureException).toHaveBeenCalledWith(caught);
    });
  });

  it("drops what it kept, and stops listening, when the page turns reporting off", async () => {
    const target = new EventTarget() as unknown as Window;
    const load = vi.fn<() => Promise<ErrorReporter>>();
    const options = vi.fn(() => Promise.resolve(null));
    reportErrorsLazily(target, options, load);

    target.dispatchEvent(
      new ErrorEvent("error", { error: new Error("first") }),
    );
    await vi.waitFor(() => {
      expect(options).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    target.dispatchEvent(
      new ErrorEvent("error", { error: new Error("later") }),
    );
    await Promise.resolve();

    expect(load).not.toHaveBeenCalled();
    expect(options).toHaveBeenCalledTimes(1);
  });
});

describe("startErrorReporting", () => {
  it("hears an error caught during the first render, while the page is still being parsed", async () => {
    // The page as instrumentation-client meets it: still loading, its head
    // (with the settings) not yet readable.
    let parsed = false;
    const page = new EventTarget() as EventTarget & {
      readyState: DocumentReadyState;
      querySelector: () => { getAttribute: () => string } | null;
    };
    page.readyState = "loading";
    page.querySelector = () =>
      parsed
        ? {
            getAttribute: () =>
              JSON.stringify({
                dsn: "https://public@sentry.example/1",
                environment: "test",
              }),
          }
        : null;
    const target = new EventTarget() as unknown as Window;
    const reporter = { init: vi.fn(), captureException: vi.fn() };
    startErrorReporting(target, page, () => Promise.resolve(reporter));
    const caught = new Error("The readiness panel could not render");

    // An error boundary reports before DOMContentLoaded.
    target.dispatchEvent(new ErrorEvent("error", { error: caught }));
    parsed = true;
    page.readyState = "interactive";
    page.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => {
      expect(reporter.captureException).toHaveBeenCalledWith(caught);
    });
    expect(reporter.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://public@sentry.example/1" }),
    );
  });
});

describe("whenParsed", () => {
  it.each(["interactive", "complete"] as const)(
    "resolves at once when the page is already %s",
    async (readyState) => {
      // DOMContentLoaded has fired: waiting for it would wait forever.
      const page = Object.assign(new EventTarget(), { readyState });

      await expect(whenParsed(page)).resolves.toBeUndefined();
    },
  );

  it("waits for DOMContentLoaded while the page is loading", async () => {
    const page = new EventTarget() as EventTarget & {
      readyState: DocumentReadyState;
    };
    page.readyState = "loading";
    let parsed = false;
    const waiting = whenParsed(page).then(() => {
      parsed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parsed).toBe(false);
    page.dispatchEvent(new Event("DOMContentLoaded"));
    await waiting;

    expect(parsed).toBe(true);
  });
});
