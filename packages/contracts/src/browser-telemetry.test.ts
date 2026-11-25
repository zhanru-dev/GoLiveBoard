import { describe, expect, it } from "vitest";

import { BrowserTelemetryRequest } from "./browser-telemetry.js";

describe("BrowserTelemetryRequest", () => {
  it("takes Web Vitals and real-time failures for known routes", () => {
    expect(
      BrowserTelemetryRequest.safeParse({
        measurements: [
          { kind: "web-vital", name: "LCP", value: 812.4, route: "/e/:slug" },
          { kind: "web-vital", name: "CLS", value: 0.02, route: "/e/:slug" },
          { kind: "realtime-failure", reason: "lost", route: "/e/:slug/watch" },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      "a real path, not a template",
      {
        kind: "web-vital",
        name: "LCP",
        value: 800,
        route: "/e/product-launch-k3x9q2mz7a",
      },
    ],
    [
      "an unknown metric",
      { kind: "web-vital", name: "FID", value: 10, route: "/" },
    ],
    [
      "a negative value",
      { kind: "web-vital", name: "INP", value: -1, route: "/" },
    ],
    [
      "a paint slower than two minutes",
      { kind: "web-vital", name: "LCP", value: 120_001, route: "/" },
    ],
    [
      "an interaction slower than two minutes",
      { kind: "web-vital", name: "INP", value: 120_001, route: "/" },
    ],
    [
      "a layout shift beyond reason",
      { kind: "web-vital", name: "CLS", value: 1_000, route: "/" },
    ],
    [
      "an unknown failure",
      { kind: "realtime-failure", reason: "other", route: "/" },
    ],
  ])("refuses %s", (_, measurement) => {
    expect(
      BrowserTelemetryRequest.safeParse({ measurements: [measurement] })
        .success,
    ).toBe(false);
  });

  it("keeps nothing beyond the schema", () => {
    const parsed = BrowserTelemetryRequest.parse({
      measurements: [
        {
          kind: "realtime-failure",
          reason: "lost",
          route: "/",
          email: "ada@example.com",
        },
      ],
    });

    expect(JSON.stringify(parsed)).not.toContain("ada@example.com");
  });

  it("refuses more than ten measurements at once", () => {
    const measurement = {
      kind: "realtime-failure",
      reason: "lost",
      route: "/",
    };
    expect(
      BrowserTelemetryRequest.safeParse({
        measurements: Array(11).fill(measurement),
      }).success,
    ).toBe(false);
  });
});
