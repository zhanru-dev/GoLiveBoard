import type { TriageSuggestions } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import { scoreCase } from "./score.js";

const grouping = (...groups: string[][]): TriageSuggestions => ({
  groups: groups.map((questionIds) => ({
    representativeId: questionIds[0] ?? "",
    questionIds,
    reason: "",
  })),
  answerOrder: [],
});
const same = (key: string) => key;

describe("scoreCase", () => {
  it("scores the expected grouping 1", () => {
    expect(
      scoreCase(
        [
          ["a", "b", "c"],
          ["d", "e"],
        ],
        grouping(["c", "a", "b"], ["e", "d"]),
        same,
      ),
    ).toEqual({ score: 1, precision: 1, recall: 1, brokenRules: [] });
  });

  it("scores a partial grouping by the F1 of its pairs", () => {
    // Expected pairs: ab, ac, bc. Found: ab, ad. Right: 1 of 2; found 1 of 3.
    const result = scoreCase(
      [["a", "b", "c"]],
      grouping(["a", "b", "d"]),
      same,
    );
    expect(result.precision).toBeCloseTo(1 / 3);
    expect(result.recall).toBeCloseTo(1 / 3);
    expect(result.score).toBeCloseTo(1 / 3);
  });

  it("scores nothing found 0 when something was expected", () => {
    expect(scoreCase([["a", "b"]], grouping(), same).score).toBe(0);
  });

  it("scores a case with nothing to group 1 only when nothing is grouped", () => {
    expect(scoreCase([], grouping(), same).score).toBe(1);
    expect(scoreCase([], grouping(["a", "b"]), same).score).toBe(0);
  });

  it("scores 0 when a question that must stay alone is grouped", () => {
    const result = scoreCase([["a", "b"]], grouping(["a", "b", "x"]), same, [
      "x",
    ]);
    expect(result.score).toBe(0);
    expect(result.brokenRules).toEqual(["x"]);
  });

  it("reads question IDs back to keys", () => {
    const keys = new Map([
      ["id-1", "a"],
      ["id-2", "b"],
    ]);
    expect(
      scoreCase(
        [["a", "b"]],
        grouping(["id-1", "id-2"]),
        (id) => keys.get(id) ?? id,
      ).score,
    ).toBe(1);
  });
});
