import { describe, expect, it } from "vitest";

import { formatInZone, utcToZoned, zonedToUtc } from "./time";

describe("zonedToUtc", () => {
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
      "the day before the clocks change",
      "2026-03-28T12:00",
      "Europe/London",
      "2026-03-28T12:00:00.000Z",
    ],
    [
      "the day after the clocks change",
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
  ])("converts %s", (_label, local, zone, utc) => {
    expect(zonedToUtc(local, zone)).toBe(utc);
  });

  it("moves a time skipped by the spring change to just after the gap", () => {
    // Clocks in London jump from 01:00 to 02:00 on 29 March 2026.
    expect(zonedToUtc("2026-03-29T01:30", "Europe/London")).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });
});

describe("utcToZoned", () => {
  it.each([
    ["2026-07-01T17:00:00.000Z", "Europe/London", "2026-07-01T18:00"],
    ["2026-12-01T14:30:00.000Z", "America/New_York", "2026-12-01T09:30"],
  ])("shows %s in %s as %s", (iso, zone, local) => {
    expect(utcToZoned(iso, zone)).toBe(local);
  });

  it("round-trips with zonedToUtc", () => {
    const local = "2026-10-25T23:45";
    expect(
      utcToZoned(zonedToUtc(local, "Europe/Berlin"), "Europe/Berlin"),
    ).toBe(local);
  });
});

describe("formatInZone", () => {
  it("shows the time in the event's zone, not the browser's", () => {
    expect(formatInZone("2026-07-01T17:00:00.000Z", "Europe/London")).toBe(
      "Wed, 1 Jul 2026, 18:00 BST",
    );
  });
});
