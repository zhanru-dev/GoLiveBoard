import { describe, expect, it } from "vitest";

import { overviewCsv } from "./overview-csv.js";
import { summariseOverview } from "./overview.js";

describe("overviewCsv", () => {
  it("writes the totals, the months and the events, defusing formulas", () => {
    const csv = overviewCsv(
      summariseOverview({ from: "2026-11-01", to: "2026-11-30" }, [
        {
          id: "0195f0a0-0000-7000-8000-0000000000e1",
          title: "=HYPERLINK(1), launch",
          startsAt: "2026-11-02T18:00:00.000Z",
          registered: 3,
          verified: 2,
          attended: 2,
          questionsAsked: 1,
          questionsAnswered: 1,
          chatMessages: 4,
          incidents: 0,
          peakAudience: 2,
        },
      ]),
    );
    const [figures, months, events] = csv.trimEnd().split("\r\n\r\n");

    expect(figures?.split("\r\n").slice(0, 4)).toEqual([
      "metric,value",
      "from,2026-11-01",
      "to,2026-11-30",
      "events,1",
    ]);
    expect(months).toBe(
      "month,events,registered,attended,questions_asked\r\n2026-11,1,3,2,1",
    );
    expect(events?.split("\r\n")[1]).toBe(
      `"'=HYPERLINK(1), launch",2026-11-02T18:00:00.000Z,3,2,2,2,1,1,4,0`,
    );
  });
});
