import { describe, expect, it } from "vitest";

import {
  formatInZone,
  offsetLabel,
  offsetMinutes,
  resolveZonedTime,
  timeInZone,
  timeZones,
  utcToZoned,
} from "./time";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Every instant in 2026 at which the zone's offset changes, to the minute:
 * a daily scan finds the day, then halving finds the minute.
 */
function clockChanges(timeZone: string): number[] {
  const changes: number[] = [];
  const start = Date.UTC(2026, 0, 1);
  const offsetAt = (ms: number) => offsetMinutes(new Date(ms), timeZone);
  for (let day = start; day < Date.UTC(2027, 0, 1); day += DAY_MS) {
    if (offsetAt(day) === offsetAt(day + DAY_MS)) {
      continue;
    }
    let before = day;
    let after = day + DAY_MS;
    while (after - before > MINUTE_MS) {
      const middle =
        before + Math.floor((after - before) / 2 / MINUTE_MS) * MINUTE_MS;
      if (offsetAt(middle) === offsetAt(day)) before = middle;
      else after = middle;
    }
    changes.push(after);
  }
  return changes;
}

const outcomes = (local: string, zone: string): string[] => {
  const resolved = resolveZonedTime(local, zone);
  if (resolved.kind === "exact") return [resolved.utc];
  if (resolved.kind === "ambiguous") return [resolved.earlier, resolved.later];
  return [];
};

describe("resolveZonedTime", () => {
  it.each([
    [
      "London in winter (GMT)",
      "2026-12-01T18:00",
      "Europe/London",
      "2026-12-01T18:00:00.000Z",
    ],
    [
      "London in summer (BST)",
      "2026-07-01T18:00",
      "Europe/London",
      "2026-07-01T17:00:00.000Z",
    ],
    [
      "New York in winter",
      "2026-12-01T09:30",
      "America/New_York",
      "2026-12-01T14:30:00.000Z",
    ],
    [
      "Kolkata, a half-hour offset",
      "2026-12-01T18:00",
      "Asia/Kolkata",
      "2026-12-01T12:30:00.000Z",
    ],
    ["UTC", "2026-12-01T18:00", "UTC", "2026-12-01T18:00:00.000Z"],
    [
      "the day after London's clocks change",
      "2026-03-30T12:00",
      "Europe/London",
      "2026-03-30T11:00:00.000Z",
    ],
    [
      "just after midnight across the date line",
      "2026-12-02T00:30",
      "Pacific/Auckland",
      "2026-12-01T11:30:00.000Z",
    ],
    [
      "the hour before New York's clocks go back",
      "2026-11-01T00:30",
      "America/New_York",
      "2026-11-01T04:30:00.000Z",
    ],
    [
      "the hour after New York's clocks go back",
      "2026-11-01T02:30",
      "America/New_York",
      "2026-11-01T07:30:00.000Z",
    ],
  ])("finds one instant for %s", (_label, local, zone, utc) => {
    expect(resolveZonedTime(local, zone)).toEqual({ kind: "exact", utc });
  });

  it.each([
    [
      "New York",
      "2026-11-01T01:30",
      "America/New_York",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ],
    [
      "London",
      "2026-10-25T01:15",
      "Europe/London",
      "2026-10-25T00:15:00.000Z",
      "2026-10-25T01:15:00.000Z",
    ],
    [
      "Auckland (UTC+13 before)",
      "2026-04-05T02:30",
      "Pacific/Auckland",
      "2026-04-04T13:30:00.000Z",
      "2026-04-04T14:30:00.000Z",
    ],
    [
      "Chatham (UTC+13:45 before)",
      "2026-04-05T03:00",
      "Pacific/Chatham",
      "2026-04-04T13:15:00.000Z",
      "2026-04-04T14:15:00.000Z",
    ],
  ])(
    "finds both instants of a time repeated when %s's clocks go back",
    (_label, local, zone, earlier, later) => {
      expect(resolveZonedTime(local, zone)).toEqual({
        kind: "ambiguous",
        earlier,
        later,
      });
    },
  );

  it.each([
    ["New York", "2026-03-08T02:30", "America/New_York"],
    ["London", "2026-03-29T01:30", "Europe/London"],
    ["Auckland", "2026-09-27T02:30", "Pacific/Auckland"],
  ])(
    "reports a time skipped when %s's clocks go forward",
    (_label, local, zone) => {
      expect(resolveZonedTime(local, zone)).toEqual({ kind: "missing" });
    },
  );

  // A correctness check over about 400 zones, not a speed limit: it takes
  // about 2 s alone and has taken over 5 s in a busy full run.
  it(
    "finds every instant around every clock change of 2026, in every zone",
    {
      timeout: 30_000,
    },
    () => {
      const misses: string[] = [];
      for (const zone of timeZones()) {
        for (const change of clockChanges(zone)) {
          // Every quarter hour from three hours before to three hours after.
          for (let step = -12; step <= 12; step += 1) {
            const instant = new Date(change + step * 15 * MINUTE_MS);
            const utc = instant.toISOString();
            const local = utcToZoned(utc, zone);
            if (!outcomes(local, zone).includes(utc)) {
              misses.push(`${zone} ${local} → ${utc}`);
            }
          }
        }
      }
      expect(misses).toEqual([]);
    },
  );
});

describe("utcToZoned", () => {
  it.each([
    ["2026-07-01T17:00:00.000Z", "Europe/London", "2026-07-01T18:00"],
    ["2026-12-01T14:30:00.000Z", "America/New_York", "2026-12-01T09:30"],
    ["2026-11-01T06:30:00.000Z", "America/New_York", "2026-11-01T01:30"],
  ])("shows %s in %s as %s", (iso, zone, local) => {
    expect(utcToZoned(iso, zone)).toBe(local);
  });
});

describe("offsetLabel", () => {
  it("tells the two 01:30s of a New York autumn night apart", () => {
    expect(offsetLabel("2026-11-01T05:30:00.000Z", "America/New_York")).toBe(
      "UTC−04:00",
    );
    expect(offsetLabel("2026-11-01T06:30:00.000Z", "America/New_York")).toBe(
      "UTC−05:00",
    );
  });
});

describe("timeInZone", () => {
  it("shows the time of day in the event's zone", () => {
    expect(timeInZone("2026-12-01T17:05:00.000Z", "America/New_York")).toBe(
      "12:05",
    );
    expect(timeInZone("2026-07-01T17:05:00.000Z", "Europe/London")).toBe(
      "18:05",
    );
  });
});

describe("formatInZone", () => {
  it("shows the time in the event's zone, not the browser's", () => {
    expect(formatInZone("2026-07-01T17:00:00.000Z", "Europe/London")).toBe(
      "Wed, 1 Jul 2026, 18:00 BST",
    );
  });
});
