import { describe, expect, it } from "vitest";

import {
  formatInZone,
  offsetLabel,
  resolveZonedTime,
  utcToZoned,
} from "./time";

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
  ])(
    "reports a time skipped when %s's clocks go forward",
    (_label, local, zone) => {
      expect(resolveZonedTime(local, zone)).toEqual({ kind: "missing" });
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

describe("formatInZone", () => {
  it("shows the time in the event's zone, not the browser's", () => {
    expect(formatInZone("2026-07-01T17:00:00.000Z", "Europe/London")).toBe(
      "Wed, 1 Jul 2026, 18:00 BST",
    );
  });
});
