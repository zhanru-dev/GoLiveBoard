import { describe, expect, it } from "vitest";

import {
  isStreamCheckDue,
  type ScheduledEvent,
  slotFor,
} from "./stream-schedule.js";

const startsAt = new Date("2026-12-01T18:00:00Z");
const endsAt = new Date("2026-12-01T19:00:00Z");
const event = (changes: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  status: "READY",
  startsAt,
  endsAt,
  streamUrl: "https://stream.example.com/index.m3u8",
  ...changes,
});
const at = (iso: string) => new Date(iso);

describe("isStreamCheckDue", () => {
  it.each([
    ["61 minutes before the start", "2026-12-01T16:59:00Z", false],
    ["exactly 60 minutes before the start", "2026-12-01T17:00:00Z", true],
    ["during the event", "2026-12-01T18:30:00Z", true],
    ["at the end", "2026-12-01T19:00:00Z", false],
  ])("for a READY event %s: %s", (_label, now, due) => {
    expect(isStreamCheckDue(event(), at(now))).toBe(due);
  });

  it("keeps checking a LIVE event that runs past its end", () => {
    expect(
      isStreamCheckDue(event({ status: "LIVE" }), at("2026-12-01T19:20:00Z")),
    ).toBe(true);
  });

  it.each(["COMPLETED", "CANCELLED", "ARCHIVED"] as const)(
    "never checks a %s event",
    (status) => {
      expect(
        isStreamCheckDue(event({ status }), at("2026-12-01T18:30:00Z")),
      ).toBe(false);
    },
  );

  it("never checks an event without a stream URL", () => {
    expect(
      isStreamCheckDue(event({ streamUrl: null }), at("2026-12-01T18:30:00Z")),
    ).toBe(false);
  });
});

describe("slotFor", () => {
  it.each([
    ["2026-12-01T18:00:00.000Z", "2026-12-01T18:00:00.000Z"],
    ["2026-12-01T18:00:29.999Z", "2026-12-01T18:00:00.000Z"],
    ["2026-12-01T18:00:30.000Z", "2026-12-01T18:00:30.000Z"],
  ])("puts %s in the slot starting %s", (now, slot) => {
    expect(slotFor(at(now)).toISOString()).toBe(slot);
  });
});
