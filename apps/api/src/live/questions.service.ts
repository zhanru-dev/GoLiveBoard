import { Inject, Injectable } from "@nestjs/common";
import type {
  ErrorCode,
  ModerateQuestionRequest,
  Question,
  QuestionList,
  QuestionsEventKind,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { demoHasRoomForQuestion } from "../demo/demo-workspace.js";
import {
  lockEventById,
  lockWritableEvent,
} from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { Idempotency } from "../idempotency/idempotency.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import {
  initialQuestionStatus,
  isQuestionVisibleTo,
  isVotable,
  type ModerationPlan,
  planModeration,
  type QuestionViewer,
} from "./domain/questions.js";
import { Fanout } from "./fanout.js";
import {
  type Authorization,
  canWrite,
  type EventRef,
  type Identity,
  type Participant,
  Participants,
} from "./participants.js";
import {
  authorKeyOf,
  isPublic,
  QUESTION_SELECT,
  type QuestionRow,
  toQuestion,
  withdrawn,
} from "./question-view.js";
import { authorRoom, channelRoom, moderatorsRoom } from "./rooms.js";

/** Who is asking, voting or listing, and from which request. */
export interface Viewer {
  readonly identity: Identity;
  readonly requestId: string;
}

/** The error for each reason planModeration refuses a change. */
const REFUSAL = {
  ILLEGAL_TRANSITION: "QUESTION_STATUS_INVALID",
  NOT_PINNABLE: "QUESTION_NOT_PINNABLE",
  PIN_LIMIT_REACHED: "PIN_LIMIT_REACHED",
} as const satisfies Record<
  Extract<ModerationPlan, { allowed: false }>["reason"],
  ErrorCode
>;

/** The most questions a list returns: pinned first, then by votes. */
const LIST_LIMIT = 500;

/** Q&A (FR-RN-4, FR-RN-5). */
@Injectable()
export class QuestionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly participants: Participants,
    private readonly rateLimiter: RateLimiter,
    private readonly idempotency: Idempotency,
    private readonly fanout: Fanout,
  ) {}

  /**
   * Asks a question. With pre-moderation on, an attendee's question waits
   * for a moderator, seen only by them and its author (FR-RN-4). Decided
   * under the event's row lock, like a chat message. With an idempotency
   * key a retry returns the first answer and stores nothing again.
   *
   * @throws DomainError `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
   * `INTERACTION_CLOSED`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED`
   */
  async ask(
    viewer: Viewer,
    ref: EventRef,
    body: string,
    idempotencyKey: string | undefined,
  ): Promise<{ question: Question; replayed: boolean }> {
    const eventId = await this.eventIdOf(viewer, ref);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const participant = await this.decideUnderLock(tx, viewer, eventId);
      if (!canWrite(participant)) {
        throw new DomainError("FORBIDDEN");
      }
      const work = async () => {
        await this.rateLimiter.consumeOrThrow(
          RATE_LIMITS.questionsPerAuthor,
          participant.attendeeId ?? participant.userId ?? "",
        );
        if (
          !(await demoHasRoomForQuestion(tx, participant.workspaceId, eventId))
        ) {
          throw new DomainError("RATE_LIMITED", {
            detail: "The demo event has as many questions as it can take.",
          });
        }
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { questionsPreModerated: true },
        });
        const row = await tx.question.create({
          data: {
            eventId,
            body,
            status: initialQuestionStatus(
              event.questionsPreModerated,
              participant.moderator,
            ),
            ...(initialQuestionStatus(
              event.questionsPreModerated,
              participant.moderator,
            ) === "PUBLISHED" && { firstPublishedAt: this.clock.now() }),
            authorAttendeeId: participant.attendeeId,
            authorUserId:
              participant.attendeeId === undefined
                ? participant.userId
                : undefined,
          },
          select: QUESTION_SELECT,
        });
        const sequence = await this.journal(tx, eventId, "CREATED", row.id);
        return {
          status: 201,
          body: { question: { ...toQuestion(row), mine: true }, sequence },
        };
      };
      if (idempotencyKey === undefined) {
        return { ...(await work()).body, replayed: false };
      }
      const result = await this.idempotency.run(
        tx,
        {
          scope: `ask:${eventId}:${authorKey(participant)}`,
          key: idempotencyKey,
          body: { body },
        },
        work,
      );
      return {
        ...(result.body as { question: Question; sequence: number }),
        replayed: result.replayed,
      };
    });
    if (!outcome.replayed) {
      await this.broadcast(
        eventId,
        outcome.sequence,
        "CREATED",
        outcome.question.id,
      );
    }
    return { question: outcome.question, replayed: outcome.replayed };
  }

  /**
   * Votes for a question, or takes the vote back (FR-RN-4). Attendees only,
   * one vote each (the primary key); doing it twice changes nothing.
   *
   * @throws DomainError `FORBIDDEN` for staff, `NOT_FOUND`,
   * `QUESTION_NOT_VOTABLE`, `INTERACTION_CLOSED`, `RATE_LIMITED`
   */
  async vote(
    viewer: Viewer,
    ref: EventRef,
    questionId: string,
    on: boolean,
  ): Promise<Question> {
    const eventId = await this.eventIdOf(viewer, ref);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const participant = await this.decideUnderLock(tx, viewer, eventId);
      const { attendeeId } = participant;
      if (attendeeId === undefined) {
        // Only the attendee routes call this, with an attendee session.
        throw new Error("vote() needs an attendee");
      }
      const question = await tx.question.findFirst({
        where: { id: questionId, eventId },
        select: QUESTION_SELECT,
      });
      if (
        question === null ||
        !isQuestionVisibleTo(question, viewerOf(participant))
      ) {
        throw new DomainError("NOT_FOUND");
      }
      if (!isVotable(question)) {
        throw new DomainError("QUESTION_NOT_VOTABLE");
      }
      await this.rateLimiter.consumeOrThrow(
        RATE_LIMITS.votesPerAttendee,
        attendeeId,
      );
      const changed = on
        ? await tx.$executeRaw`
            INSERT INTO question_votes (question_id, attendee_id)
            VALUES (${questionId}::uuid, ${attendeeId}::uuid)
            ON CONFLICT DO NOTHING`
        : await tx.$executeRaw`
            DELETE FROM question_votes
            WHERE question_id = ${questionId}::uuid
              AND attendee_id = ${attendeeId}::uuid`;
      if (changed === 0) {
        return { question, sequence: undefined };
      }
      const updated = await tx.question.update({
        where: { id: questionId },
        data: { voteCount: { increment: on ? 1 : -1 } },
        select: QUESTION_SELECT,
      });
      const sequence = await this.journal(tx, eventId, "VOTED", questionId);
      return { question: updated, sequence };
    });
    if (outcome.sequence !== undefined) {
      await this.broadcast(eventId, outcome.sequence, "VOTED", questionId);
    }
    return { ...toQuestion(outcome.question), votedByMe: on };
  }

  /**
   * A moderator's change (FR-RN-5): approve, hide, answer (also in
   * writing), reopen, pin or unpin.
   * Two moderators editing the same version: one wins, the other gets
   * `412`. Pins are decided under the event's row lock, and the database
   * allows three at most whatever happens.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`, `VERSION_CONFLICT`,
   * `QUESTION_STATUS_INVALID`, `QUESTION_NOT_PINNABLE`, `PIN_LIMIT_REACHED`
   */
  async moderate(
    actor: Actor,
    questionId: string,
    expectedVersion: number,
    change: ModerateQuestionRequest,
  ): Promise<Question> {
    const found = await this.prisma.question.findFirst({
      where: { id: questionId, event: { workspaceId: actor.workspaceId } },
      select: { eventId: true },
    });
    if (found === null) {
      throw new DomainError("NOT_FOUND");
    }
    const { eventId } = found;
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const current = await tx.question.findUniqueOrThrow({
        where: { id: questionId },
        select: QUESTION_SELECT,
      });
      if (current.version !== expectedVersion) {
        throw new DomainError("VERSION_CONFLICT");
      }
      const others = await tx.question.findMany({
        where: { eventId, pinSlot: { not: null }, id: { not: questionId } },
        select: { pinSlot: true },
      });
      const plan = planModeration(
        current,
        change,
        others.flatMap(({ pinSlot }) => (pinSlot === null ? [] : [pinSlot])),
      );
      if (!plan.allowed) {
        throw new DomainError(REFUSAL[plan.reason]);
      }
      if (
        plan.status === current.status &&
        plan.pinSlot === current.pinSlot &&
        plan.answer === current.answer
      ) {
        return { row: current, sequence: undefined };
      }
      const now = this.clock.now();
      const row = await tx.question.update({
        where: { id: questionId },
        data: {
          status: plan.status,
          pinSlot: plan.pinSlot,
          answer: plan.answer,
          answeredAt: answeredAtFor(plan.answer, current, now),
          ...(current.firstPublishedAt === null &&
            (plan.status === "PUBLISHED" || plan.status === "ANSWERED") && {
              firstPublishedAt: now,
            }),
          version: { increment: 1 },
          updatedAt: now,
        },
        select: QUESTION_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "question.moderated",
        targetType: "question",
        targetId: questionId,
        eventId,
        before: {
          status: current.status,
          pinSlot: current.pinSlot,
          answer: current.answer,
        },
        after: {
          status: plan.status,
          pinSlot: plan.pinSlot,
          answer: plan.answer,
        },
      });
      const sequence = await this.journal(tx, eventId, "UPDATED", questionId);
      return { row, sequence };
    });
    if (outcome.sequence !== undefined) {
      await this.broadcast(eventId, outcome.sequence, "UPDATED", questionId);
    }
    return toQuestion(outcome.row);
  }

  /**
   * Merges questions into others (AI triage, FR-RN-6), in the caller's
   * transaction, which holds the event's row lock. A merged question leaves
   * the public list (its author and moderators still see it, marked), loses
   * its pin, and its votes move to the question it was merged into, each
   * attendee counted once. One that was merged meanwhile is left alone.
   *
   * @returns the journal entries to announce once the transaction commits
   */
  async mergeIn(
    tx: Prisma.TransactionClient,
    eventId: string,
    merges: readonly { readonly questionId: string; readonly into: string }[],
  ): Promise<Announcement[]> {
    const announcements: Announcement[] = [];
    const representatives = new Set<string>();
    for (const { questionId, into } of merges) {
      const { count } = await tx.question.updateMany({
        where: { id: questionId, eventId, mergedIntoId: null },
        data: {
          mergedIntoId: into,
          pinSlot: null,
          voteCount: 0,
          version: { increment: 1 },
          updatedAt: this.clock.now(),
        },
      });
      if (count === 0) {
        continue;
      }
      await tx.$executeRaw`
        INSERT INTO question_votes (question_id, attendee_id, created_at)
        SELECT ${into}::uuid, attendee_id, created_at FROM question_votes
        WHERE question_id = ${questionId}::uuid
        ON CONFLICT DO NOTHING`;
      await tx.questionVote.deleteMany({ where: { questionId } });
      representatives.add(into);
      announcements.push({
        sequence: await this.journal(tx, eventId, "UPDATED", questionId),
        kind: "UPDATED",
        questionId,
      });
    }
    for (const questionId of representatives) {
      await tx.$executeRaw`
        UPDATE questions SET vote_count = (
          SELECT count(*) FROM question_votes WHERE question_id = ${questionId}::uuid
        )
        WHERE id = ${questionId}::uuid`;
      announcements.push({
        sequence: await this.journal(tx, eventId, "VOTED", questionId),
        kind: "VOTED",
        questionId,
      });
    }
    return announcements;
  }

  /** Sends committed journal entries to everyone on the event's Q&A. */
  async announce(
    eventId: string,
    announcements: readonly Announcement[],
  ): Promise<void> {
    for (const { sequence, kind, questionId } of announcements) {
      await this.broadcast(eventId, sequence, kind, questionId);
    }
  }

  /**
   * The questions this viewer may see: published and answered ones, their
   * own, and every one for moderators. Pinned first, then by votes.
   *
   * @throws DomainError `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`
   */
  async list(viewer: Viewer, ref: EventRef): Promise<QuestionList> {
    const participant = this.require(
      await this.participants.authorize(viewer.identity, ref, viewer.requestId),
    );
    const { eventId } = participant;
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { questionsSequence: true },
    });
    const who = viewerOf(participant);
    const rows = await this.prisma.question.findMany({
      where: {
        eventId,
        ...(who.moderator
          ? {}
          : {
              OR: [
                {
                  status: { in: ["PUBLISHED", "ANSWERED"] },
                  mergedIntoId: null,
                },
                ...(who.attendeeId === undefined
                  ? []
                  : [{ authorAttendeeId: who.attendeeId }]),
                ...(who.userId === undefined
                  ? []
                  : [{ authorUserId: who.userId }]),
              ],
            }),
      },
      orderBy: [
        { pinSlot: { sort: "asc", nulls: "last" } },
        { voteCount: "desc" },
        { createdAt: "asc" },
      ],
      take: LIST_LIMIT,
      select: QUESTION_SELECT,
    });
    const voted =
      who.attendeeId === undefined
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.questionVote.findMany({
                where: {
                  attendeeId: who.attendeeId,
                  questionId: { in: rows.map((row) => row.id) },
                },
                select: { questionId: true },
              })
            ).map((vote) => vote.questionId),
          );
    return {
      items: rows.map((row) => ({
        ...toQuestion(row),
        mine:
          (who.attendeeId !== undefined &&
            row.authorAttendeeId === who.attendeeId) ||
          (who.userId !== undefined && row.authorUserId === who.userId),
        votedByMe: voted.has(row.id),
      })),
      latestSequence: Number(event.questionsSequence),
    };
  }

  /** Resolves the event before the transaction; refuses who may not see it. */
  private async eventIdOf(viewer: Viewer, ref: EventRef): Promise<string> {
    return this.require(
      await this.participants.authorize(viewer.identity, ref, viewer.requestId),
    ).eventId;
  }

  /**
   * Locks the event's row, then decides again: every change to who may take
   * part takes the same lock, so one that committed first is seen.
   */
  private async decideUnderLock(
    tx: Prisma.TransactionClient,
    viewer: Viewer,
    eventId: string,
  ): Promise<Participant> {
    if (!(await lockEventById(tx, eventId))) {
      throw new DomainError("NOT_FOUND");
    }
    const participant = this.require(
      await this.participants.authorize(
        viewer.identity,
        { id: eventId },
        viewer.requestId,
        tx,
      ),
    );
    if (!participant.open) {
      throw new DomainError("INTERACTION_CLOSED");
    }
    return participant;
  }

  private require(access: Authorization): Participant {
    if (access.ok) {
      return access.participant;
    }
    throw new DomainError(
      access.error === "CLOSED" ? "INTERACTION_CLOSED" : access.error,
    );
  }

  /** Takes the next Q&A sequence and records the entry. */
  private async journal(
    tx: Prisma.TransactionClient,
    eventId: string,
    kind: QuestionsEventKind,
    questionId: string,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<{ questions_sequence: bigint }[]>`
      UPDATE events SET questions_sequence = questions_sequence + 1
      WHERE id = ${eventId}::uuid
      RETURNING questions_sequence`;
    if (row === undefined) {
      throw new DomainError("NOT_FOUND");
    }
    await tx.realtimeJournal.create({
      data: {
        eventId,
        channel: "QUESTIONS",
        sequence: row.questions_sequence,
        kind,
        entityId: questionId,
      },
    });
    return Number(row.questions_sequence);
  }

  /**
   * Sends a change to everyone on the event's Q&A, as each may see it: the
   * question to those who may see it, WITHDRAWN to the rest, so nobody
   * finds a gap in the sequence. The question is read after the commit:
   * if it changed again since, the newer state goes out, which is what the
   * later entry will say anyway.
   */
  private async broadcast(
    eventId: string,
    sequence: number,
    kind: QuestionsEventKind,
    questionId: string,
  ): Promise<void> {
    const row = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: QUESTION_SELECT,
    });
    const everyone = channelRoom(eventId, "QUESTIONS");
    if (row === null) {
      this.fanout.toRooms([everyone], [], "questions.event", {
        sequence,
        kind: "WITHDRAWN",
      });
      return;
    }
    const full = { sequence, kind, question: toQuestion(row) };
    if (isPublic(row)) {
      this.fanout.toRooms([everyone], [], "questions.event", full);
      return;
    }
    const author = authorKeyOf(row);
    const privileged = [
      moderatorsRoom(eventId),
      ...(author === undefined ? [] : [authorRoom(eventId, author)]),
    ];
    this.fanout.toRooms(privileged, [], "questions.event", full);
    this.fanout.toRooms(
      [everyone],
      privileged,
      "questions.event",
      withdrawn(sequence, row),
    );
  }
}

/** When the answer was written: now if it changed, as it was if not. */
function answeredAtFor(
  answer: string | null,
  current: { readonly answer: string | null; readonly answeredAt: Date | null },
  now: Date,
): Date | null {
  if (answer === null) return null;
  return answer === current.answer ? current.answeredAt : now;
}

/** A journal entry to send once its transaction has committed. */
export interface Announcement {
  readonly sequence: number;
  readonly kind: QuestionsEventKind;
  readonly questionId: string;
}

/** What isQuestionVisibleTo needs to know about a participant. */
export function viewerOf(participant: Participant): QuestionViewer {
  return {
    attendeeId: participant.attendeeId,
    userId: participant.kind === "STAFF" ? participant.userId : undefined,
    moderator: participant.moderator,
  };
}

/** `attendee:<id>` or `user:<id>`, as the author rooms name them. */
export function authorKey(participant: Participant): string {
  return participant.kind === "ATTENDEE"
    ? `attendee:${participant.attendeeId ?? ""}`
    : `user:${participant.userId ?? ""}`;
}

export type { QuestionRow };
