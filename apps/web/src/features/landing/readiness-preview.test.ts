import { describe, expect, it } from "vitest";

import { previewReadiness } from "./readiness-preview";

describe("previewReadiness", () => {
  it("adds up to 100 points, as rule version 1 does", () => {
    const { criteria } = previewReadiness(false);

    expect(criteria.reduce((sum, c) => sum + c.maxScore, 0)).toBe(100);
  });

  it("scores 72 with the critical task open, which blocks Ready", () => {
    expect(previewReadiness(false)).toMatchObject({ score: 72, blockers: 1 });
  });

  it("scores 98, not 100, once it is done: 10 of 12 tasks give 8 of 10 points", () => {
    const readiness = previewReadiness(true);

    expect(readiness).toMatchObject({ score: 98, blockers: 0 });
    expect(
      readiness.criteria.find((c) => c.name === "All tasks done"),
    ).toMatchObject({
      detail: "10 of 12",
      score: 8,
    });
  });
});
