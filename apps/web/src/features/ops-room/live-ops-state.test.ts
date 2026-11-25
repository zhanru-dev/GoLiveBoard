import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INCIDENT, ROOM } from "@/testing/ops-room";

import { applyMessage } from "./live-ops-state";

describe("applyMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T17:02:10.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes a snapshot whole, and ignores a malformed one", () => {
    expect(applyMessage(undefined, { event: "snapshot", data: ROOM })).toEqual(
      ROOM,
    );
    expect(applyMessage(ROOM, { event: "snapshot", data: { nope: 1 } })).toBe(
      ROOM,
    );
  });

  it("needs a snapshot before anything else", () => {
    expect(
      applyMessage(undefined, { event: "rates.updated", data: ROOM.rates }),
    ).toBeUndefined();
  });

  it("updates the stream status and the rates", () => {
    const stream = {
      ok: false,
      checkedAt: "2026-12-01T17:05:00.000Z",
      latencyMs: 0,
    };
    const rates = { messagesPerMinute: 9, questionsPerMinute: 2 };
    let room = applyMessage(ROOM, { event: "stream.status", data: stream });
    room = applyMessage(room, { event: "rates.updated", data: rates });

    expect(room?.stream).toEqual(stream);
    expect(room?.rates).toEqual(rates);
  });

  it("adds the audience to the chart as this minute's point, once", () => {
    let room = applyMessage(ROOM, {
      event: "audience.updated",
      data: { current: 5, peak: 5 },
    });
    room = applyMessage(room, {
      event: "audience.updated",
      data: { current: 4, peak: 5 },
    });

    expect(room?.audience.current).toBe(4);
    expect(room?.audience.peak).toBe(5);
    expect(room?.audience.series.at(-1)).toEqual({
      minute: "2026-12-01T17:02:00.000Z",
      viewers: 4,
    });
    expect(room?.audience.series).toHaveLength(3);
  });

  it("opens and resolves incidents, each on the timeline once", () => {
    let room = applyMessage(ROOM, { event: "incident.opened", data: INCIDENT });
    room = applyMessage(room, { event: "incident.opened", data: INCIDENT });
    expect(room?.incidents).toEqual([INCIDENT]);

    room = applyMessage(room, {
      event: "incident.resolved",
      data: { ...INCIDENT, resolvedAt: "2026-12-01T17:06:00.000Z" },
    });

    expect(room?.incidents).toEqual([]);
    expect(room?.timeline.map(({ kind }) => kind)).toEqual([
      "STATUS_CHANGED",
      "INCIDENT_OPENED",
      "INCIDENT_RESOLVED",
    ]);
  });

  it("ignores messages it does not know", () => {
    expect(applyMessage(ROOM, { event: "something.new", data: {} })).toBe(ROOM);
  });
});
