import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushErrorReports } from "./error-reporting.js";
import { ErrorReportFlusher } from "./observability.module.js";
import { stopTelemetry } from "./telemetry.js";

vi.mock("./telemetry.js", () => ({ stopTelemetry: vi.fn() }));
vi.mock("./error-reporting.js", () => ({ flushErrorReports: vi.fn() }));

/** A promise settled from outside, to hold one side of the stop open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("ErrorReportFlusher", () => {
  const warn = vi.fn();
  const flusher = new ErrorReportFlusher({ warn } as unknown as Logger);

  beforeEach(() => {
    vi.mocked(stopTelemetry).mockReset();
    vi.mocked(flushErrorReports).mockReset();
    warn.mockReset();
  });

  it("flushes error reports without waiting for telemetry to stop", async () => {
    const telemetry = deferred<boolean>();
    vi.mocked(stopTelemetry).mockReturnValue(telemetry.promise);
    vi.mocked(flushErrorReports).mockResolvedValue(true);

    const stopping = flusher.onApplicationShutdown();
    // Telemetry is still stopping (a collector that does not answer), and
    // the error reports are already on their way.
    await Promise.resolve();
    expect(flushErrorReports).toHaveBeenCalledTimes(1);

    telemetry.resolve(true);
    await stopping;
    expect(warn).not.toHaveBeenCalled();
  });

  it("says which of the two was not sent in time", async () => {
    vi.mocked(stopTelemetry).mockResolvedValue(true);
    vi.mocked(flushErrorReports).mockResolvedValue(false);

    await flusher.onApplicationShutdown();

    expect(warn.mock.calls).toEqual([
      ["Error reports not sent in time; the rest was dropped"],
    ]);

    warn.mockReset();
    vi.mocked(stopTelemetry).mockResolvedValue(false);
    vi.mocked(flushErrorReports).mockResolvedValue(true);

    await flusher.onApplicationShutdown();

    expect(warn.mock.calls).toEqual([
      ["Telemetry not sent in time; the rest was dropped"],
    ]);
  });
});
