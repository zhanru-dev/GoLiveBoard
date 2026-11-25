import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type * as BrowserTelemetry from "@/lib/browser-telemetry";
import { FakeRealtimeConnection, fakeRealtimeModule } from "@/testing/live";

import { useLiveConnection } from "./use-live";

vi.mock("@/features/live/realtime-connection", () => fakeRealtimeModule());

// What reaches the telemetry collector, through the real de-duplication;
// and what use-live.ts passed, as an argument would replace the collector.
const reported = vi.hoisted(() => [] as string[]);
const reporterArguments = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/browser-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserTelemetry>();
  return {
    ...actual,
    realtimeFailureReporter: (...args: unknown[]) => {
      reporterArguments.push(args);
      return actual.realtimeFailureReporter((reason) => reported.push(reason));
    },
  };
});

const failure = (reason: "connect-failed" | "lost") => {
  FakeRealtimeConnection.last?.options.onFailure?.(reason);
};

describe("useLiveConnection's real-time failures", () => {
  it("reports each reason once per page view, and again in the next view", () => {
    reported.length = 0;
    reporterArguments.length = 0;

    // The visitor opens the watch page; the connection fails, then keeps
    // being lost while it reconnects.
    const first = renderHook(() => useLiveConnection("launch"));
    failure("connect-failed");
    failure("lost");
    failure("lost");
    first.unmount();

    // They come back to the watch page: a new view, a new connection.
    const next = renderHook(() => useLiveConnection("launch"));
    failure("lost");
    next.unmount();

    expect(reported).toEqual(["connect-failed", "lost", "lost"]);
    // One reporter per view, each sending to the collector (no argument).
    expect(reporterArguments).toEqual([[], []]);
  });
});
