import type { TriageSuggestions } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import {
  acceptedGroupsExist,
  planMerges,
  type QuestionState,
} from "./merge.js";

const id = (n: number) =>
  `0193f2a4-0000-7000-8000-${String(n).padStart(12, "0")}`;

const SUGGESTIONS: TriageSuggestions = {
  groups: [
    { representativeId: id(1), questionIds: [id(1), id(2), id(3)], reason: "" },
    { representativeId: id(4), questionIds: [id(4), id(5)], reason: "" },
  ],
  answerOrder: [id(1), id(4)],
};

const open = (...ns: number[]): QuestionState[] =>
  ns.map((n) => ({ id: id(n), status: "PUBLISHED", mergedIntoId: null }));

describe("planMerges", () => {
  it("merges every accepted group's questions into its representative", () => {
    expect(planMerges(SUGGESTIONS, [0, 1], open(1, 2, 3, 4, 5))).toEqual({
      merges: [
        { questionId: id(2), into: id(1) },
        { questionId: id(3), into: id(1) },
        { questionId: id(5), into: id(4) },
      ],
      decision: "ACCEPTED",
    });
  });

  it("rejects when no group is accepted, and is partial in between", () => {
    expect(planMerges(SUGGESTIONS, [], open(1, 2, 3, 4, 5))).toEqual({
      merges: [],
      decision: "REJECTED",
    });
    expect(planMerges(SUGGESTIONS, [1], open(1, 2, 3, 4, 5))).toEqual({
      merges: [{ questionId: id(5), into: id(4) }],
      decision: "PARTIAL",
    });
  });

  it("skips what changed since the run: a member merged or deleted, a representative gone", () => {
    const now: QuestionState[] = [
      { id: id(1), status: "PUBLISHED", mergedIntoId: null },
      { id: id(2), status: "PUBLISHED", mergedIntoId: id(9) }, // merged elsewhere since
      // id(3) deleted since
      { id: id(4), status: "PUBLISHED", mergedIntoId: id(1) }, // representative merged since
      { id: id(5), status: "PUBLISHED", mergedIntoId: null },
    ];

    expect(planMerges(SUGGESTIONS, [0, 1], now)).toEqual({
      merges: [],
      decision: "PARTIAL",
    });
  });

  it("never merges into a question others cannot see: a pending or hidden representative merges nothing", () => {
    for (const status of ["PENDING", "HIDDEN"] as const) {
      const now: QuestionState[] = [
        { id: id(1), status, mergedIntoId: null },
        ...open(2, 3, 4, 5),
      ];

      expect(planMerges(SUGGESTIONS, [0, 1], now)).toEqual({
        merges: [{ questionId: id(5), into: id(4) }],
        decision: "PARTIAL",
      });
    }
  });

  it("merges into an answered question, and leaves a hidden member alone", () => {
    const now: QuestionState[] = [
      { id: id(1), status: "ANSWERED", mergedIntoId: null },
      { id: id(2), status: "HIDDEN", mergedIntoId: null },
      { id: id(3), status: "PENDING", mergedIntoId: null },
      ...open(4, 5),
    ];

    expect(planMerges(SUGGESTIONS, [0], now).merges).toEqual([
      { questionId: id(3), into: id(1) },
    ]);
  });
});

describe("acceptedGroupsExist", () => {
  it("knows the run's groups", () => {
    expect(acceptedGroupsExist(SUGGESTIONS, [0, 1])).toBe(true);
    expect(acceptedGroupsExist(SUGGESTIONS, [2])).toBe(false);
  });
});
