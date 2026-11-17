import type { QuestionStatus } from "@opspilot/contracts";

/** The pin slots (FR-RN-5): at most this many questions are pinned. */
export const PIN_SLOTS = [1, 2, 3] as const;

/**
 * The status a new question starts in (FR-RN-4). A moderator's own question
 * needs nobody's approval; with pre-moderation on, an attendee's waits.
 */
export function initialQuestionStatus(
  preModerated: boolean,
  authorIsModerator: boolean,
): QuestionStatus {
  return preModerated && !authorIsModerator ? "PENDING" : "PUBLISHED";
}

/** Who is looking at a question. */
export interface QuestionViewer {
  readonly attendeeId?: string;
  readonly userId?: string;
  readonly moderator: boolean;
}

export interface QuestionAuthorship {
  readonly status: QuestionStatus;
  readonly mergedIntoId: string | null;
  readonly authorAttendeeId: string | null;
  readonly authorUserId: string | null;
}

/**
 * Published and answered questions are for everyone, unless merged into
 * another (FR-RN-6); a pending, hidden or merged one only for its author
 * and moderators.
 */
export function isQuestionVisibleTo(
  question: QuestionAuthorship,
  viewer: QuestionViewer,
): boolean {
  if (isPublicQuestion(question)) {
    return true;
  }
  if (viewer.moderator) {
    return true;
  }
  return (
    (viewer.attendeeId !== undefined &&
      viewer.attendeeId === question.authorAttendeeId) ||
    (viewer.userId !== undefined && viewer.userId === question.authorUserId)
  );
}

/** For everyone: published or answered, and not merged into another. */
export function isPublicQuestion(
  question: Pick<QuestionAuthorship, "status" | "mergedIntoId">,
): boolean {
  return (
    (question.status === "PUBLISHED" || question.status === "ANSWERED") &&
    question.mergedIntoId === null
  );
}

/** Whether attendees may vote for it: published, and not merged. */
export function isVotable(
  question: Pick<QuestionAuthorship, "status" | "mergedIntoId">,
): boolean {
  return question.status === "PUBLISHED" && question.mergedIntoId === null;
}

const TRANSITIONS: Readonly<Record<QuestionStatus, readonly QuestionStatus[]>> =
  {
    PENDING: ["PUBLISHED", "HIDDEN"],
    PUBLISHED: ["HIDDEN", "ANSWERED"],
    HIDDEN: ["PUBLISHED"],
    ANSWERED: ["PUBLISHED"],
  };

/** What a moderator asks for; anything left out stays as it is. */
export interface ModerationChange {
  readonly status?: QuestionStatus;
  /** Pin it (it takes the lowest free slot) or unpin it. */
  readonly pinned?: boolean;
}

export type ModerationPlan =
  | {
      readonly allowed: true;
      readonly status: QuestionStatus;
      readonly pinSlot: number | null;
    }
  | {
      readonly allowed: false;
      readonly reason:
        "ILLEGAL_TRANSITION" | "NOT_PINNABLE" | "PIN_LIMIT_REACHED";
    };

/**
 * Plans a moderation change (FR-RN-5).
 *
 * - Statuses move only as TRANSITIONS lists; asking for the current one is
 *   no change.
 * - Only a published or answered question can be pinned. Hiding it, or
 *   sending it back to pending, unpins it.
 * - A newly pinned question takes the lowest slot no other question of the
 *   event holds. The database enforces the limit too, under concurrency.
 *
 * @param usedSlots the slots other questions of the event hold
 */
export function planModeration(
  current: {
    readonly status: QuestionStatus;
    readonly pinSlot: number | null;
    /** A question merged into another is never pinned (FR-RN-6). */
    readonly mergedIntoId?: string | null;
  },
  change: ModerationChange,
  usedSlots: readonly number[],
): ModerationPlan {
  const status = change.status ?? current.status;
  if (
    status !== current.status &&
    !TRANSITIONS[current.status].includes(status)
  ) {
    return { allowed: false, reason: "ILLEGAL_TRANSITION" };
  }
  const visible =
    (status === "PUBLISHED" || status === "ANSWERED") &&
    (current.mergedIntoId ?? null) === null;
  const wantsPin = change.pinned ?? current.pinSlot !== null;
  if (!wantsPin || !visible) {
    if (change.pinned === true) {
      return { allowed: false, reason: "NOT_PINNABLE" };
    }
    return { allowed: true, status, pinSlot: null };
  }
  if (current.pinSlot !== null) {
    return { allowed: true, status, pinSlot: current.pinSlot };
  }
  const free = PIN_SLOTS.find((slot) => !usedSlots.includes(slot));
  if (free === undefined) {
    return { allowed: false, reason: "PIN_LIMIT_REACHED" };
  }
  return { allowed: true, status, pinSlot: free };
}
