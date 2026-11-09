import { describe, expect, it } from "vitest";

import { HealthReport } from "./health.js";

describe("HealthReport", () => {
  it("accepts a report with one check per dependency", () => {
    const report = {
      status: "unavailable",
      checks: {
        database: { status: "up", durationMs: 3 },
        valkey: { status: "down", durationMs: 2000 },
      },
    };

    expect(HealthReport.parse(report)).toEqual(report);
  });

  it("rejects a check with a negative duration", () => {
    const report = {
      status: "ok",
      checks: { database: { status: "up", durationMs: -1 } },
    };

    expect(HealthReport.safeParse(report).success).toBe(false);
  });
});
