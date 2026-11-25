import { afterEach, describe, expect, it } from "vitest";

import { METRICS } from "../observability/metrics.js";
import { RATE_LIMITS, type RateLimiter } from "../rate-limit/rate-limiter.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { captureMetrics, type CapturedMetrics } from "../testing/metrics.js";
import {
  BrowserTelemetryService,
  visitorOf,
} from "./browser-telemetry.service.js";

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

describe("the telemetry limits", () => {
  it("all fail closed: what cannot be counted is not recorded", () => {
    expect(RATE_LIMITS.browserTelemetryPerIp.failClosed).toBe(true);
    expect(RATE_LIMITS.browserVitalPerVisitor.failClosed).toBe(true);
    expect(RATE_LIMITS.browserFailurePerVisitor.failClosed).toBe(true);
  });
});

describe("visitorOf", () => {
  it("keeps an IPv4 address, and an IPv4-mapped one, as they are", () => {
    expect(visitorOf("198.18.41.7")).toBe("198.18.41.7");
    expect(visitorOf("::ffff:198.18.41.7")).toBe("::ffff:198.18.41.7");
  });

  it("takes an IPv6 address's /64, however it is written", () => {
    expect(visitorOf("2001:db8:41:7::1")).toBe("2001:db8:41:7::/64");
    expect(visitorOf("2001:0DB8:0041:0007:ffff:1:2:3")).toBe(
      "2001:db8:41:7::/64",
    );
    expect(visitorOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorOf("::1")).toBe("0:0:0:0::/64");
  });
});
