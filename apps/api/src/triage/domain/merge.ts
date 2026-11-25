import type {
  QuestionStatus,
  TriageDecision,
  TriageSuggestions,
} from "@opspilot/contracts";

export interface QuestionState {
  readonly id: string;
  readonly status: QuestionStatus;
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
 * (they may have changed since the run). A merge must never hide a public
 * question behind one nobody else sees, so:
 *
 * - a group merges only into a representative that is public now
 *   (published or answered, not merged); one pending, hidden, merged or
 *   deleted since merges nothing;
 * - its other questions merge unless they are hidden, merged or deleted.
 *
 * The decision is ACCEPTED when every group was accepted and merged,
 * REJECTED when none was accepted, PARTIAL otherwise.
 */
export function planMerges(
  suggestions: TriageSuggestions,
  acceptedGroups: readonly number[],
  questions: readonly QuestionState[],
): MergePlan {
  const now = new Map(questions.map((question) => [question.id, question]));
  const representable = (id: string) => {
    const question = now.get(id);
    return (
      question?.mergedIntoId === null &&
      (question.status === "PUBLISHED" || question.status === "ANSWERED")
    );
  };
  const mergeable = (id: string) => {
    const question = now.get(id);
    return question?.mergedIntoId === null && question.status !== "HIDDEN";
  };
  const accepted = new Set(acceptedGroups);
  const merges: Merge[] = [];
  let applied = 0;
  suggestions.groups.forEach((group, index) => {
    if (!accepted.has(index) || !representable(group.representativeId)) {
      return;
    }
    applied += 1;
    for (const id of group.questionIds) {
      if (id !== group.representativeId && mergeable(id)) {
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
