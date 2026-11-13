import { describe, expect, it } from "vitest";

import { dayRange } from "./event-list-filters";

describe("dayRange", () => {
  it("covers whole days in the browser's zone, the last one included", () => {
    expect(dayRange("2026-03-28", "2026-03-29")).toEqual({
      from: new Date("2026-03-28T00:00").toISOString(),
      to: new Date("2026-03-30T00:00").toISOString(),
    });
  });

  it("crosses the end of a month and a year", () => {
    expect(dayRange("", "2026-12-31").to).toBe(
      new Date("2027-01-01T00:00").toISOString(),
    );
  });

  it("leaves out an empty end", () => {
    expect(dayRange("", "")).toEqual({});
    expect(Object.keys(dayRange("2026-12-01", ""))).toEqual(["from"]);
  });
});
