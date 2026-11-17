import type { TriageSuggestions } from "@opspilot/contracts";

export type SuggestionCheck =
  | { readonly ok: true; readonly suggestions: TriageSuggestions }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * ADR-0012: the model's suggestions are checked again before anyone sees
 * them. Every ID must be one of the questions it was given, a question is
 * in one group at most, a group's representative is one of its questions,
 * and the answer order names each question once and none merged away. One
 * broken rule discards them all: a half-right grouping is not shown.
 */
export function checkSuggestions(
  given: readonly string[],
  suggested: TriageSuggestions,
): SuggestionCheck {
  const known = new Set(given);
  const problems: string[] = [];
  const grouped = new Map<string, number>();
  const mergedAway = new Set<string>();
  suggested.groups.forEach((group, index) => {
    const members = new Set(group.questionIds);
    if (members.size !== group.questionIds.length) {
      problems.push(`group ${String(index)} names a question twice`);
    }
    if (members.size < 2) {
      problems.push(`group ${String(index)} has fewer than two questions`);
    }
    if (!members.has(group.representativeId)) {
      problems.push(`group ${String(index)}'s representative is not in it`);
    }
    for (const id of members) {
      if (!known.has(id)) {
        problems.push(`group ${String(index)} names an unknown question`);
      }
      const other = grouped.get(id);
      if (other !== undefined) {
        problems.push(
          `a question is in groups ${String(other)} and ${String(index)}`,
        );
      }
      grouped.set(id, index);
      if (id !== group.representativeId) {
        mergedAway.add(id);
      }
    }
  });
  const ordered = new Set<string>();
  for (const id of suggested.answerOrder) {
    if (!known.has(id)) {
      problems.push("the answer order names an unknown question");
    } else if (ordered.has(id)) {
      problems.push("the answer order names a question twice");
    } else if (mergedAway.has(id)) {
      problems.push("the answer order names a question merged away");
    }
    ordered.add(id);
  }
  return problems.length === 0
    ? { ok: true, suggestions: suggested }
    : { ok: false, problems: [...new Set(problems)] };
}
