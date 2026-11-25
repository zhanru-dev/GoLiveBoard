import { describe, expect, it } from "vitest";

import {
  dateIn,
  DEMO_LIMIT,
  DEMO_TRIAGE_DAILY_MICROS,
  DEMO_TRIAGE_DAILY_RUNS,
  maxOutputTokens,
  mayRun,
  reserveMicros,
  startOfDay,
} from "./budget.js";

describe("mayRun", () => {
  const none = { runs: 0, spentMicros: 0, reservedMicros: 0 };

  it("counts runs against the demo's daily runs", () => {
    expect(
      mayRun({ ...none, runs: DEMO_TRIAGE_DAILY_RUNS - 1 }, 0, DEMO_LIMIT),
    ).toBe(true);
    expect(
      mayRun({ ...none, runs: DEMO_TRIAGE_DAILY_RUNS }, 0, DEMO_LIMIT),
    ).toBe(false);
  });

  it("counts what was spent, what runs at the moment reserve, and the new run's reservation", () => {
    const limit = { micros: 1_000 };
    expect(
      mayRun({ ...none, spentMicros: 400, reservedMicros: 300 }, 300, limit),
    ).toBe(true);
    expect(
      mayRun({ ...none, spentMicros: 400, reservedMicros: 300 }, 301, limit),
    ).toBe(false);
    expect(
      mayRun({ ...none, spentMicros: 0, reservedMicros: 1_000 }, 1, limit),
    ).toBe(false);
    // A real workspace's limit has no count of runs.
    expect(mayRun({ ...none, runs: 10_000 }, 0, limit)).toBe(true);
  });

  it("is the demo's: 30 runs or a dollar a day", () => {
    expect(DEMO_LIMIT).toEqual({ runs: 30, micros: DEMO_TRIAGE_DAILY_MICROS });
    expect(DEMO_TRIAGE_DAILY_MICROS).toBe(1_000_000);
  });
});

describe("maxOutputTokens and reserveMicros", () => {
  it("gives a run room for its groups, at most 8,000 tokens", () => {
    expect(maxOutputTokens(1)).toBe(1_040);
    expect(maxOutputTokens(50)).toBe(3_000);
    expect(maxOutputTokens(200)).toBe(8_000);
  });

  it("reserves a run's prompt at a token a byte, and its whole output allowance, at the given price", () => {
    // 3,000 bytes → 3,000 tokens + 1,000 for the instructions = 4,000 in
    // at $5/M; 1,400 out (10 questions) at $25/M.
    expect(reserveMicros(3_000, 10, { input: 5, output: 25 })).toBe(
      4_000 * 5 + 1_400 * 25,
    );
  });
});

describe("dateIn", () => {
  it("names the calendar day in the zone", () => {
    expect(dateIn(new Date("2026-07-01T23:30:00.000Z"), "Europe/London")).toBe(
      "2026-07-02",
    );
    expect(dateIn(new Date("2026-12-01T23:30:00.000Z"), "Europe/London")).toBe(
      "2026-12-01",
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
