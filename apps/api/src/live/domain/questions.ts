import type { QuestionStatus } from "@goliveboard/contracts";

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
  /** Write or replace the answer, or remove it with null. */
  readonly answer?: string | null;
}

export type ModerationPlan =
  | {
      readonly allowed: true;
      readonly status: QuestionStatus;
      readonly pinSlot: number | null;
      readonly answer: string | null;
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
 * - Only an answered question has a written answer. Writing one on a
 *   published question marks it answered; on a pending, hidden or merged
 *   one it is refused (approve it first). Reopening removes the answer.
 *
 * @param usedSlots the slots other questions of the event hold
 */
export function planModeration(
  current: {
    readonly status: QuestionStatus;
    readonly pinSlot: number | null;
    /** A question merged into another is never pinned (FR-RN-6). */
    readonly mergedIntoId?: string | null;
    readonly answer?: string | null;
  },
  change: ModerationChange,
  usedSlots: readonly number[],
): ModerationPlan {
  const merged = (current.mergedIntoId ?? null) !== null;
  const written = typeof change.answer === "string" ? change.answer : undefined;
  // Answering a published question in writing answers it.
  const answers = written !== undefined && current.status === "PUBLISHED";
  const status = change.status ?? (answers ? "ANSWERED" : current.status);
  if (
    status !== current.status &&
    !TRANSITIONS[current.status].includes(status)
  ) {
    return { allowed: false, reason: "ILLEGAL_TRANSITION" };
  }
  if (written !== undefined && (status !== "ANSWERED" || merged)) {
    return { allowed: false, reason: "ILLEGAL_TRANSITION" };
  }
  // Left out, the answer stays; it goes whenever the question stops being answered.
  const requested =
    change.answer === undefined ? (current.answer ?? null) : change.answer;
  const answer = status === "ANSWERED" ? requested : null;
  const visible = (status === "PUBLISHED" || status === "ANSWERED") && !merged;
  const wantsPin = change.pinned ?? current.pinSlot !== null;
  if (!wantsPin || !visible) {
    if (change.pinned === true) {
      return { allowed: false, reason: "NOT_PINNABLE" };
    }
    return { allowed: true, status, pinSlot: null, answer };
  }
  if (current.pinSlot !== null) {
    return { allowed: true, status, pinSlot: current.pinSlot, answer };
  }
  const free = PIN_SLOTS.find((slot) => !usedSlots.includes(slot));
  if (free === undefined) {
    return { allowed: false, reason: "PIN_LIMIT_REACHED" };
  }
  return { allowed: true, status, pinSlot: free, answer };
}
