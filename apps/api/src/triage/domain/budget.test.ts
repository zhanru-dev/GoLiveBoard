import { describe, expect, it } from "vitest";

import {
  DEMO_TRIAGE_DAILY_MICROS,
  DEMO_TRIAGE_DAILY_RUNS,
  demoMayRun,
  startOfDay,
} from "./budget.js";

describe("demoMayRun", () => {
  it("allows runs until either the count or the spend reaches its limit", () => {
    expect(demoMayRun({ runs: 0, costMicros: 0 })).toBe(true);
    expect(
      demoMayRun({
        runs: DEMO_TRIAGE_DAILY_RUNS - 1,
        costMicros: DEMO_TRIAGE_DAILY_MICROS - 1,
      }),
    ).toBe(true);
    expect(demoMayRun({ runs: DEMO_TRIAGE_DAILY_RUNS, costMicros: 0 })).toBe(
      false,
    );
    expect(demoMayRun({ runs: 0, costMicros: DEMO_TRIAGE_DAILY_MICROS })).toBe(
      false,
    );
  });
});

describe("startOfDay", () => {
  it.each([
    // Winter: London is UTC.
    ["2026-12-01T15:30:00.000Z", "Europe/London", "2026-12-01T00:00:00.000Z"],
    // Summer: London is UTC+1, so its midnight is 23:00 UTC the day before.
    ["2026-07-01T00:30:00.000Z", "Europe/London", "2026-06-30T23:00:00.000Z"],
    ["2026-07-01T22:59:00.000Z", "Europe/London", "2026-06-30T23:00:00.000Z"],
    ["2026-07-01T23:00:00.000Z", "Europe/London", "2026-07-01T23:00:00.000Z"],
    // The night the clocks go forward (29 March 2026) and back (25 October).
    ["2026-03-29T12:00:00.000Z", "Europe/London", "2026-03-29T00:00:00.000Z"],
    ["2026-10-25T12:00:00.000Z", "Europe/London", "2026-10-24T23:00:00.000Z"],
    [
      "2026-12-01T03:00:00.000Z",
      "America/New_York",
      "2026-11-30T05:00:00.000Z",
    ],
    // New Zealand moves its clocks forward at 02:00 on 27 September: that
    // day began at +12 (NZST), though the zone is at +13 by midday UTC.
    [
      "2026-09-27T05:00:00.000Z",
      "Pacific/Auckland",
      "2026-09-26T12:00:00.000Z",
    ],
  ])("finds the midnight that began %s in %s", (now, zone, midnight) => {
    expect(startOfDay(new Date(now), zone).toISOString()).toBe(midnight);
  });
});
