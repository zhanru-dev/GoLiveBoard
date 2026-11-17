import type { TriageSuggestions } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import { checkSuggestions } from "./suggestions.js";

const id = (n: number) =>
  `0193f2a4-0000-7000-8000-${String(n).padStart(12, "0")}`;
const GIVEN = [1, 2, 3, 4, 5].map(id);

const GROUP = {
  representativeId: id(1),
  questionIds: [id(1), id(2), id(3)],
  reason: "Same pricing question",
};

const ok: TriageSuggestions = {
  groups: [
    {
      representativeId: id(1),
      questionIds: [id(1), id(2), id(3)],
      reason: "Same pricing question",
    },
  ],
  answerOrder: [id(1), id(4), id(5)],
};

describe("checkSuggestions", () => {
  it("accepts suggestions that name only the given questions, each once", () => {
    expect(checkSuggestions(GIVEN, ok)).toEqual({ ok: true, suggestions: ok });
  });

  it("accepts no groups and no order", () => {
    expect(checkSuggestions(GIVEN, { groups: [], answerOrder: [] }).ok).toBe(
      true,
    );
  });

  it.each<[string, TriageSuggestions, string]>([
    [
      "an unknown question in a group",
      { ...ok, groups: [{ ...GROUP, questionIds: [id(1), id(9)] }] },
      "group 0 names an unknown question",
    ],
    [
      "a representative outside its group",
      { ...ok, groups: [{ ...GROUP, representativeId: id(4) }] },
      "group 0's representative is not in it",
    ],
    [
      "a question in two groups",
      {
        groups: [
          { representativeId: id(1), questionIds: [id(1), id(2)], reason: "" },
          { representativeId: id(3), questionIds: [id(3), id(2)], reason: "" },
        ],
        answerOrder: [],
      },
      "a question is in groups 0 and 1",
    ],
    [
      "a question twice in one group",
      { ...ok, groups: [{ ...GROUP, questionIds: [id(1), id(1)] }] },
      "group 0 names a question twice",
    ],
    [
      "an unknown question in the order",
      { ...ok, answerOrder: [id(1), id(9)] },
      "the answer order names an unknown question",
    ],
    [
      "a question twice in the order",
      { ...ok, answerOrder: [id(1), id(1)] },
      "the answer order names a question twice",
    ],
    [
      "a merged-away question in the order",
      { ...ok, answerOrder: [id(2)] },
      "the answer order names a question merged away",
    ],
  ])("refuses %s, all of it", (_label, suggested, problem) => {
    const check = checkSuggestions(GIVEN, suggested);

    expect(check.ok).toBe(false);
    expect(check.ok ? [] : check.problems).toContain(problem);
  });
});
