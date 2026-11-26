import { describe, expect, it } from "vitest";

import { statusOf } from "./readiness-panel";

describe("statusOf", () => {
  it.each([
    [{ blocking: true, score: 0, maxScore: 25 }, "Blocker"],
    [{ blocking: false, score: 10, maxScore: 10 }, "Passed"],
    [{ blocking: false, score: 7, maxScore: 10 }, "Partial"],
    [{ blocking: false, score: 0, maxScore: 10 }, "Partial"],
  ])("labels %o as %s", (criterion, label) => {
    expect(statusOf(criterion).label).toBe(label);
  });
});
