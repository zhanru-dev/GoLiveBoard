import type { TriageSuggestions } from "@goliveboard/contracts";

/** Every unordered pair of keys that share a group. */
function pairsOf(groups: readonly (readonly string[])[]): Set<string> {
  const pairs = new Set<string>();
  for (const group of groups) {
    const keys = [...group].sort();
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        pairs.add(`${keys[i] ?? ""}|${keys[j] ?? ""}`);
      }
    }
  }
  return pairs;
}

export interface CaseScore {
  /** 0 to 1. */
  readonly score: number;
  readonly precision: number;
  readonly recall: number;
  /** Keys that had to stay alone but were grouped. */
  readonly brokenRules: readonly string[];
}

/**
 * How close a grouping is to the expected one: the F1 score of the pairs of
 * questions put together (a pair is right when both should share a group).
 * A case where nothing should be grouped scores 1 when nothing is, else 0.
 * A key that must stay alone but was grouped scores the case 0.
 */
export function scoreCase(
  expected: readonly (readonly string[])[],
  suggested: TriageSuggestions,
  keyOf: (id: string) => string,
  mustStayAlone: readonly string[] = [],
): CaseScore {
  const got = suggested.groups.map((group) => group.questionIds.map(keyOf));
  const grouped = new Set(got.flat());
  const brokenRules = mustStayAlone.filter((key) => grouped.has(key));
  const want = pairsOf(expected);
  const have = pairsOf(got);
  const right = [...have].filter((pair) => want.has(pair)).length;
  if (want.size === 0) {
    const clean = have.size === 0 && brokenRules.length === 0;
    return {
      score: clean ? 1 : 0,
      precision: clean ? 1 : 0,
      recall: 1,
      brokenRules,
    };
  }
  const precision = have.size === 0 ? 0 : right / have.size;
  const recall = right / want.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    score: brokenRules.length > 0 ? 0 : f1,
    precision,
    recall,
    brokenRules,
  };
}
