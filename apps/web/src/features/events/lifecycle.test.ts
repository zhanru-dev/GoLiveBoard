import { describe, expect, it } from "vitest";

import { nextStep, STAGES } from "./lifecycle";

describe("nextStep", () => {
  it("counts the blockers left while configuring", () => {
    expect(nextStep("CONFIGURING", 3)).toMatch(
      /^Clear 3 hard blockers, then mark the event ready/,
    );
    expect(nextStep("CONFIGURING", 1)).toMatch(/^Clear 1 hard blocker,/);
    expect(nextStep("CONFIGURING", 0)).toBe(
      "Every hard blocker passes: mark the event ready.",
    );
    expect(nextStep("CONFIGURING")).toMatch(/^Clear the hard blockers/);
  });

  it.each([
    "DRAFT",
    "READY",
    "LIVE",
    "COMPLETED",
    "ARCHIVED",
    "CANCELLED",
  ] as const)("says what to do next for %s", (status) => {
    expect(nextStep(status).length).toBeGreaterThan(10);
  });

  it("puts the stages in their order", () => {
    expect(STAGES).toEqual([
      "DRAFT",
      "CONFIGURING",
      "READY",
      "LIVE",
      "COMPLETED",
    ]);
  });
});
