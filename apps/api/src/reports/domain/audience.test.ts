import { describe, expect, it } from "vitest";

import { summariseAudience } from "./audience.js";

const at = (time: string) => new Date(`2026-11-20T${time}Z`);

describe("summariseAudience (FR-RC-3)", () => {
  it("covers the scheduled window minute by minute, with 0 where nobody watched", () => {
    const summary = summariseAudience(
      [
        { minute: at("18:00:00"), viewers: 2 },
        { minute: at("18:02:00"), viewers: 4 },
      ],
      at("18:00:00"),
      at("18:04:00"),
    );

    expect(summary.series.map(({ viewers }) => viewers)).toEqual([2, 0, 4, 0]);
    expect(summary.peak).toBe(4);
    expect(summary.average).toBe(1.5);
  });

  it("widens the window to a late start or an overrun", () => {
    const summary = summariseAudience(
      [
        { minute: at("17:59:00"), viewers: 1 },
        { minute: at("18:03:00"), viewers: 3 },
      ],
      at("18:00:00"),
      at("18:02:00"),
    );

    expect(summary.series.map(({ minute }) => minute.toISOString())).toEqual([
      "2026-11-20T17:59:00.000Z",
      "2026-11-20T18:00:00.000Z",
      "2026-11-20T18:01:00.000Z",
      "2026-11-20T18:02:00.000Z",
      "2026-11-20T18:03:00.000Z",
    ]);
    expect(summary.average).toBe(0.8);
  });

  it("is all zeros for an event nobody watched", () => {
    const summary = summariseAudience([], at("18:00:00"), at("18:02:00"));

    expect(summary).toEqual({
      series: [
        { minute: at("18:00:00"), viewers: 0 },
        { minute: at("18:01:00"), viewers: 0 },
      ],
      peak: 0,
      average: 0,
    });
  });
});
