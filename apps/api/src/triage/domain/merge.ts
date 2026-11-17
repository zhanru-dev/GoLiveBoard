import type { TriageDecision, TriageSuggestions } from "@opspilot/contracts";

export interface QuestionState {
  readonly id: string;
  readonly mergedIntoId: string | null;
}

export interface Merge {
  readonly questionId: string;
  readonly into: string;
}

export interface MergePlan {
  readonly merges: readonly Merge[];
  readonly decision: Exclude<TriageDecision, "PENDING">;
}

/**
 * What a moderator's decision does, against the questions as they are now
 * (they may have changed since the run). An accepted group merges its
 * other questions into its representative, except one already merged (or
 * deleted since); a group whose representative was merged or deleted since
 * merges nothing. The decision is ACCEPTED when every group was accepted
 * and merged, REJECTED when none was accepted, PARTIAL otherwise.
 */
export function planMerges(
  suggestions: TriageSuggestions,
  acceptedGroups: readonly number[],
  questions: readonly QuestionState[],
): MergePlan {
  const now = new Map(questions.map((question) => [question.id, question]));
  const isOpen = (id: string) => {
    return now.get(id)?.mergedIntoId === null;
  };
  const accepted = new Set(acceptedGroups);
  const merges: Merge[] = [];
  let applied = 0;
  suggestions.groups.forEach((group, index) => {
    if (!accepted.has(index) || !isOpen(group.representativeId)) {
      return;
    }
    applied += 1;
    for (const id of group.questionIds) {
      if (id !== group.representativeId && isOpen(id)) {
        merges.push({ questionId: id, into: group.representativeId });
      }
    }
  });
  let decision: MergePlan["decision"] = "PARTIAL";
  if (accepted.size === 0) {
    decision = "REJECTED";
  } else if (applied === suggestions.groups.length) {
    decision = "ACCEPTED";
  }
  return { merges, decision };
}

/** Whether every accepted index names one of the run's groups. */
export function acceptedGroupsExist(
  suggestions: TriageSuggestions,
  acceptedGroups: readonly number[],
): boolean {
  return acceptedGroups.every((index) => index < suggestions.groups.length);
}
