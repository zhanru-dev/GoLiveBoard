import { afterEach, describe, expect, it } from "vitest";

import { METRICS } from "../observability/metrics.js";
import type { RateLimiter } from "../rate-limit/rate-limiter.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { captureMetrics, type CapturedMetrics } from "../testing/metrics.js";
import { BrowserTelemetryService } from "./browser-telemetry.service.js";

describe("BrowserTelemetryService", () => {
  let captured: CapturedMetrics;

  afterEach(async () => {
    await captured.stop();
  });

  it("drops the measurements quietly while Valkey cannot count (the rule fails closed)", async () => {
    captured = captureMetrics();
    const unavailable = {
      consume: () => Promise.reject(new DomainError("SERVICE_UNAVAILABLE")),
    } as unknown as RateLimiter;

    await expect(
      new BrowserTelemetryService(unavailable).record(
        {
          measurements: [
            { kind: "realtime-failure", reason: "lost", route: "/" },
          ],
        },
        "198.18.41.250",
      ),
    ).resolves.toBeUndefined();

    expect(await captured.points(METRICS.webRealtimeFailures)).toEqual([]);
  });
});
