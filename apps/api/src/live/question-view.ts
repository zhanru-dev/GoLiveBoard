import type { Question, QuestionsEvent } from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";
import { FORMER_STAFF_NAME } from "./chat-view.js";
import {
  isPublicQuestion,
  isQuestionVisibleTo,
  type QuestionViewer,
} from "./domain/questions.js";

/** What a question is read with, to show it. */
export const QUESTION_SELECT = {
  id: true,
  body: true,
  status: true,
  pinSlot: true,
  voteCount: true,
  mergedIntoId: true,
  version: true,
  createdAt: true,
  firstPublishedAt: true,
  authorAttendeeId: true,
  authorUserId: true,
  authorAttendee: { select: { name: true } },
  authorUser: { select: { name: true } },
} as const satisfies Prisma.QuestionSelect;

export type QuestionRow = Prisma.QuestionGetPayload<{
  select: typeof QUESTION_SELECT;
}>;

/** A question as everyone who may see it sees it. */
export function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    body: row.body,
    status: row.status,
    author:
      row.authorAttendee === null
        ? { kind: "STAFF", name: row.authorUser?.name ?? FORMER_STAFF_NAME }
        : { kind: "ATTENDEE", name: row.authorAttendee.name },
    pinSlot: row.pinSlot,
    voteCount: row.voteCount,
    mergedIntoId: row.mergedIntoId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `attendee:<id>` or `user:<id>`: whose question it is, for rooms. */
export function authorKeyOf(row: {
  readonly authorAttendeeId: string | null;
  readonly authorUserId: string | null;
}): string | undefined {
  if (row.authorAttendeeId !== null) {
    return `attendee:${row.authorAttendeeId}`;
  }
  return row.authorUserId === null ? undefined : `user:${row.authorUserId}`;
}

/** Whether everyone on the channel may see a question in this state. */
export function isPublic(
  row: Pick<QuestionRow, "status" | "mergedIntoId">,
): boolean {
  return isPublicQuestion(row);
}

/**
 * The placeholder for a change the viewer may not see: with the question's
 * ID only if it was ever public (the viewer may hold it and must drop it).
 */
export function withdrawn(
  sequence: number,
  row: Pick<QuestionRow, "id" | "firstPublishedAt">,
): QuestionsEvent {
  return row.firstPublishedAt === null
    ? { sequence, kind: "WITHDRAWN" }
    : { sequence, kind: "WITHDRAWN", questionId: row.id };
}

/** The event one viewer receives for a journal entry. */
export function questionsEventFor(
  viewer: QuestionViewer,
  sequence: number,
  kind: string,
  row: QuestionRow,
): QuestionsEvent {
  if (!isQuestionVisibleTo(row, viewer)) {
    return withdrawn(sequence, row);
  }
  return {
    sequence,
    kind: kind as Exclude<QuestionsEvent["kind"], "WITHDRAWN">,
    question: toQuestion(row),
  };
}
