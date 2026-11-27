import type { OverviewEvent } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import {
  monthsOf,
  overviewSpan,
  spanBounds,
  summariseOverview,
} from "./overview.js";

const event = (
  startsAt: string,
  figures: Partial<OverviewEvent> = {},
): OverviewEvent => ({
  id: "0195f0a0-0000-7000-8000-0000000000e1",
  title: "Launch",
  startsAt,
  registered: 0,
  verified: 0,
  attended: 0,
  questionsAsked: 0,
  questionsAnswered: 0,
  chatMessages: 0,
  incidents: 0,
  peakAudience: 0,
  ...figures,
});

describe("overviewSpan", () => {
  it("defaults to the last twelve calendar months, this one included", () => {
    expect(overviewSpan({}, new Date("2026-11-27T16:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2026-11-27",
    });
    expect(overviewSpan({}, new Date("2026-01-05T00:00:00Z"))).toEqual({
      from: "2025-02-01",
      to: "2026-01-05",
    });
  });

  it("takes the span asked for", () => {
    expect(
      overviewSpan({ from: "2026-10-01", to: "2026-10-31" }, new Date()),
    ).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("spanBounds", () => {
  it("includes the whole last day", () => {
    expect(spanBounds({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
    });
  });
});

describe("monthsOf", () => {
  it("lists every month the span touches, across a year's end", () => {
    expect(monthsOf({ from: "2026-11-20", to: "2027-02-03" })).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(monthsOf({ from: "2026-11-01", to: "2026-11-01" })).toEqual([
      "2026-11",
    ]);
  });
});

describe("summariseOverview", () => {
  const span = { from: "2026-09-01", to: "2026-11-30" };

  it("adds up the events, by month too, most recent first", () => {
    const overview = summariseOverview(span, [
      event("2026-09-10T18:00:00.000Z", {
        registered: 10,
        verified: 8,
        attended: 6,
        peakAudience: 5,
        questionsAsked: 4,
        questionsAnswered: 3,
        chatMessages: 20,
        incidents: 1,
      }),
      event("2026-11-02T18:00:00.000Z", {
        registered: 5,
        verified: 5,
        attended: 2,
        peakAudience: 2,
        questionsAsked: 1,
      }),
    ]);

    expect(overview.totals).toEqual({
      events: 2,
      registered: 15,
      verified: 13,
      attended: 8,
      questionsAsked: 5,
      questionsAnswered: 3,
      chatMessages: 20,
      incidents: 1,
      peakAudience: 5,
      averagePeak: 3.5,
    });
    expect(overview.months).toEqual([
      {
        month: "2026-09",
        events: 1,
        registered: 10,
        attended: 6,
        questionsAsked: 4,
      },
      {
        month: "2026-10",
        events: 0,
        registered: 0,
        attended: 0,
        questionsAsked: 0,
      },
      {
        month: "2026-11",
        events: 1,
        registered: 5,
        attended: 2,
        questionsAsked: 1,
      },
    ]);
    expect(overview.events.map((e) => e.startsAt)).toEqual([
      "2026-11-02T18:00:00.000Z",
      "2026-09-10T18:00:00.000Z",
    ]);
  });

  it("rounds the average peak to one decimal place, and is all zeros without events", () => {
    const peaks = [1, 1, 2].map((peakAudience) =>
      event("2026-10-01T10:00:00.000Z", { peakAudience }),
    );
    expect(summariseOverview(span, peaks).totals.averagePeak).toBe(1.3);
    expect(summariseOverview(span, []).totals).toMatchObject({
      events: 0,
      peakAudience: 0,
      averagePeak: 0,
    });
  });
});
