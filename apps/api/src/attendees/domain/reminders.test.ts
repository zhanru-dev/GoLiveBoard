import { describe, expect, it } from "vitest";

import { dueReminder, isRemindable } from "./reminders.js";

const START = new Date("2026-12-01T18:00:00Z");
const before = (minutes: number) =>
  new Date(START.getTime() - minutes * 60 * 1000);

describe("dueReminder (FR-AD-5)", () => {
  it.each([
    [25 * 60, undefined],
    [24 * 60, "DAY_BEFORE"],
    [24 * 60 - 1, "DAY_BEFORE"],
    [61, "DAY_BEFORE"],
    [60, "HOUR_BEFORE"],
    [30, "HOUR_BEFORE"],
    [1, "HOUR_BEFORE"],
    [0, undefined],
    [-10, undefined],
  ])("%i minutes before the start: %s", (minutes, expected) => {
    expect(dueReminder(START, before(minutes))).toBe(expected);
  });
});

describe("isRemindable", () => {
  it("reminds only of events still being prepared", () => {
    const statuses = [
      "DRAFT",
      "CONFIGURING",
      "READY",
      "LIVE",
      "COMPLETED",
      "ARCHIVED",
      "CANCELLED",
    ] as const;
    expect(statuses.filter(isRemindable)).toEqual(["CONFIGURING", "READY"]);
  });
});
