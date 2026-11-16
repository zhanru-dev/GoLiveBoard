import { describe, expect, it } from "vitest";

import { isSuccess, MAX_ATTEMPTS, nextAttemptAt } from "./retries.js";

const start = new Date("2026-11-20T18:00:00Z");
const minutes = (date: Date | null) =>
  date === null ? null : (date.getTime() - start.getTime()) / 60_000;

describe("webhook retries (docs/04, section 6.1)", () => {
  it("retries about 1, 5, 30 and 120 minutes after the first attempt, then stops", () => {
    const middle = () => 0.5;
    const schedule: (number | null)[] = [];
    let at = start;
    for (let made = 1; made <= MAX_ATTEMPTS; made += 1) {
      const next = nextAttemptAt(made, at, middle);
      schedule.push(minutes(next));
      if (next !== null) {
        at = next;
      }
    }

    expect(schedule).toEqual([1, 5, 30, 120, null]);
  });

  it("spreads each wait by up to a tenth either way", () => {
    expect(minutes(nextAttemptAt(1, start, () => 0))).toBeCloseTo(0.9);
    expect(minutes(nextAttemptAt(1, start, () => 0.999_999))).toBeCloseTo(1.1);
    // The wait from the fourth to the fifth attempt is 90 minutes.
    expect(minutes(nextAttemptAt(4, start, () => 0))).toBeCloseTo(81);
  });

  it("has no retry before a first attempt", () => {
    expect(nextAttemptAt(0, start)).toBeNull();
  });

  it("counts any 2xx as success", () => {
    expect([199, 200, 204, 299, 300, 404, 500].filter(isSuccess)).toEqual([
      200, 204, 299,
    ]);
  });
});
