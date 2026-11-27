import { Inject, Injectable } from "@nestjs/common";
import type {
  CreatePollRequest,
  Poll,
  PollList,
  UpdatePollRequest,
} from "@goliveboard/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import {
  lockEventById,
  lockWritableEvent,
} from "../events/event-lock.queries.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { isInteractionOpen } from "./domain/interaction.js";
import { checkVote, isPollEditable, POLL_ANNOUNCE_MS } from "./domain/polls.js";
import { Fanout } from "./fanout.js";
import {
  type Authorization,
  type EventRef,
  type Participant,
  Participants,
} from "./participants.js";
import { POLL_SELECT, type PollRow, toPoll } from "./poll-view.js";
import type { Viewer } from "./questions.service.js";

/**
 * Live polls (FR-RN-8, docs/design/polls.md). Managers prepare drafts and
 * open one at a time; admitted attendees answer once. Every change to an
 * open or closed poll goes to every connection on the event as the whole
 * poll, with a version that only increases; votes are announced at most
 * once every POLL_ANNOUNCE_MS per poll.
 */
@Injectable()
export class PollsService {
  /** Polls with an announcement in its window, and whether to send again. */
  private readonly announcing = new Map<string, { again: boolean }>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly participants: Participants,
    private readonly fanout: Fanout,
    private readonly rateLimiter: RateLimiter,
    @InjectPinoLogger(PollsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Every poll of the event, newest first. @throws NOT_FOUND */
  async listForStaff(actor: Actor, eventId: string): Promise<PollList> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    const rows = await this.prisma.poll.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: POLL_SELECT,
    });
    return { items: rows.map((row) => toPoll(row)) };
  }

  /** Open and closed polls, newest first, with the attendee's own answers. */
  async listForAttendee(viewer: Viewer, ref: EventRef): Promise<PollList> {
    const participant = requireParticipant(
      await this.participants.authorize(viewer.identity, ref, viewer.requestId),
    );
    const { eventId, attendeeId } = participant;
    if (attendeeId === undefined) {
      throw new DomainError("FORBIDDEN");
    }
    const [rows, votes] = await Promise.all([
      this.prisma.poll.findMany({
        where: { eventId, status: { not: "DRAFT" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: POLL_SELECT,
      }),
      this.prisma.pollVote.findMany({
        where: { attendeeId, poll: { eventId } },
        select: { pollId: true, optionId: true },
      }),
    ]);
    const mine = new Map(votes.map((vote) => [vote.pollId, vote.optionId]));
    return { items: rows.map((row) => toPoll(row, mine.get(row.id) ?? null)) };
  }

  /** A draft (Managers). @throws NOT_FOUND, EVENT_ARCHIVED */
  async create(
    actor: Actor,
    eventId: string,
    body: CreatePollRequest,
  ): Promise<Poll> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const created = await tx.poll.create({
        data: {
          eventId,
          question: body.question,
          options: {
            create: body.options.map((label, index) => ({
              label,
              position: index + 1,
            })),
          },
        },
        select: POLL_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "poll.created",
        targetType: "poll",
        targetId: created.id,
        eventId,
        after: { question: body.question, options: body.options },
      });
      return created;
    });
    return toPoll(row);
  }

  /**
   * Edits a draft (Managers), with its version.
   *
   * @throws NOT_FOUND, EVENT_ARCHIVED, VERSION_CONFLICT, POLL_NOT_EDITABLE
   */
  async update(
    actor: Actor,
    pollId: string,
    expectedVersion: number,
    change: UpdatePollRequest,
  ): Promise<Poll> {
    const row = await this.underLock(actor, pollId, async (tx, current) => {
      if (current.version !== expectedVersion) {
        throw new DomainError("VERSION_CONFLICT");
      }
      if (!isPollEditable(current.status)) {
        throw new DomainError("POLL_NOT_EDITABLE");
      }
      if (change.options !== undefined) {
        await tx.pollOption.deleteMany({ where: { pollId } });
      }
      const updated = await tx.poll.update({
        where: { id: pollId },
        data: {
          ...(change.question !== undefined && { question: change.question }),
          ...(change.options !== undefined && {
            options: {
              create: change.options.map((label, index) => ({
                label,
                position: index + 1,
              })),
            },
          }),
          version: { increment: 1 },
          updatedAt: this.clock.now(),
        },
        select: POLL_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "poll.updated",
        targetType: "poll",
        targetId: pollId,
        eventId: current.eventId,
        before: {
          question: current.question,
          options: current.options.map((option) => option.label),
        },
        after: {
          question: updated.question,
          options: updated.options.map((option) => option.label),
        },
      });
      return updated;
    });
    return toPoll(row);
  }

  /**
   * Deletes a draft (Managers), with its version.
   *
   * @throws NOT_FOUND, EVENT_ARCHIVED, VERSION_CONFLICT, POLL_NOT_EDITABLE
   */
  async remove(
    actor: Actor,
    pollId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.underLock(actor, pollId, async (tx, current) => {
      if (current.version !== expectedVersion) {
        throw new DomainError("VERSION_CONFLICT");
      }
      if (!isPollEditable(current.status)) {
        throw new DomainError("POLL_NOT_EDITABLE");
      }
      await tx.poll.delete({ where: { id: pollId } });
      await recordAudit(tx, actor, {
        action: "poll.deleted",
        targetType: "poll",
        targetId: pollId,
        eventId: current.eventId,
        before: { question: current.question },
      });
    });
  }

  /**
   * Opens a draft (Managers) while the event takes interaction; one open
   * poll per event, which the database enforces too.
   *
   * @throws NOT_FOUND, EVENT_ARCHIVED, INTERACTION_CLOSED, POLL_NOT_EDITABLE,
   * POLL_ALREADY_OPEN
   */
  async open(actor: Actor, pollId: string): Promise<Poll> {
    const row = await this.underLock(
      actor,
      pollId,
      async (tx, current, status) => {
        if (!isInteractionOpen(status)) {
          throw new DomainError("INTERACTION_CLOSED");
        }
        if (!isPollEditable(current.status)) {
          throw new DomainError("POLL_NOT_EDITABLE");
        }
        const other = await tx.poll.findFirst({
          where: { eventId: current.eventId, status: "OPEN" },
          select: { id: true },
        });
        if (other !== null) {
          throw new DomainError("POLL_ALREADY_OPEN");
        }
        const now = this.clock.now();
        const opened = await tx.poll.update({
          where: { id: pollId },
          data: {
            status: "OPEN",
            openedAt: now,
            version: { increment: 1 },
            updatedAt: now,
          },
          select: POLL_SELECT,
        });
        await recordAudit(tx, actor, {
          action: "poll.opened",
          targetType: "poll",
          targetId: pollId,
          eventId: current.eventId,
        });
        return opened;
      },
    );
    this.send(row.eventId, toPoll(row));
    return toPoll(row);
  }

  /** Closes an open poll (Managers). @throws NOT_FOUND, EVENT_ARCHIVED, POLL_NOT_OPEN */
  async close(actor: Actor, pollId: string): Promise<Poll> {
    const row = await this.underLock(actor, pollId, async (tx, current) => {
      if (current.status !== "OPEN") {
        throw new DomainError("POLL_NOT_OPEN");
      }
      const now = this.clock.now();
      const closed = await tx.poll.update({
        where: { id: pollId },
        data: {
          status: "CLOSED",
          closedAt: now,
          version: { increment: 1 },
          updatedAt: now,
        },
        select: POLL_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "poll.closed",
        targetType: "poll",
        targetId: pollId,
        eventId: current.eventId,
        after: { totalVotes: toPoll(closed).totalVotes },
      });
      return closed;
    });
    this.send(row.eventId, toPoll(row));
    return toPoll(row);
  }

  /**
   * An admitted attendee's answer: one per poll, final. Decided under the
   * event's lock, which every change to who may take part also takes, and
   * closing the poll too: an answer counts before the close or not at all.
   * The same answer again (a retry, another tab) is taken as already given.
   *
   * @throws NOT_FOUND, FORBIDDEN (staff), INTERACTION_CLOSED, POLL_NOT_OPEN,
   * POLL_OPTION_INVALID, POLL_ALREADY_VOTED (for another option),
   * RATE_LIMITED
   */
  async vote(
    viewer: Viewer,
    ref: EventRef,
    pollId: string,
    optionId: string,
  ): Promise<Poll> {
    const { eventId } = requireParticipant(
      await this.participants.authorize(viewer.identity, ref, viewer.requestId),
    );
    const { row, counted } = await this.prisma.$transaction(async (tx) => {
      // Decided again under the event's lock, which every change to who
      // may take part also takes.
      if (!(await lockEventById(tx, eventId))) {
        throw new DomainError("NOT_FOUND");
      }
      const { attendeeId, open } = requireParticipant(
        await this.participants.authorize(
          viewer.identity,
          { id: eventId },
          viewer.requestId,
          tx,
        ),
      );
      if (attendeeId === undefined) {
        throw new DomainError("FORBIDDEN");
      }
      if (!open) {
        throw new DomainError("INTERACTION_CLOSED");
      }
      const poll = await tx.poll.findFirst({
        where: { id: pollId, eventId, status: { not: "DRAFT" } },
        select: POLL_SELECT,
      });
      if (poll === null) {
        throw new DomainError("NOT_FOUND");
      }
      const check = checkVote(
        { status: poll.status, optionIds: poll.options.map(({ id }) => id) },
        optionId,
      );
      if (!check.ok) {
        throw new DomainError(check.reason);
      }
      await this.rateLimiter.consumeOrThrow(
        RATE_LIMITS.votesPerAttendee,
        attendeeId,
      );
      const inserted = await tx.$executeRaw`
        INSERT INTO poll_votes (poll_id, attendee_id, option_id)
        VALUES (${pollId}::uuid, ${attendeeId}::uuid, ${optionId}::uuid)
        ON CONFLICT DO NOTHING`;
      if (inserted === 0) {
        const given = await tx.pollVote.findUnique({
          where: { pollId_attendeeId: { pollId, attendeeId } },
          select: { optionId: true },
        });
        if (given?.optionId !== optionId) {
          throw new DomainError("POLL_ALREADY_VOTED");
        }
        return { row: poll, counted: false };
      }
      await tx.pollOption.update({
        where: { id: optionId },
        data: { voteCount: { increment: 1 } },
      });
      const updated = await tx.poll.update({
        where: { id: pollId },
        data: { version: { increment: 1 } },
        select: POLL_SELECT,
      });
      return { row: updated, counted: true };
    });
    if (counted) {
      this.announce(row.eventId, row.id);
    }
    return toPoll(row, optionId);
  }

  /** Locks the poll's event (writable), then reads the poll. */
  private async underLock<T>(
    actor: Actor,
    pollId: string,
    work: (
      tx: Prisma.TransactionClient,
      current: PollRow,
      eventStatus: Awaited<ReturnType<typeof lockWritableEvent>>["status"],
    ) => Promise<T>,
  ): Promise<T> {
    const found = await this.prisma.poll.findFirst({
      where: { id: pollId, event: { workspaceId: actor.workspaceId } },
      select: { eventId: true },
    });
    if (found === null) {
      throw new DomainError("NOT_FOUND");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const event = await lockWritableEvent(
          tx,
          actor.workspaceId,
          found.eventId,
        );
        const current = await tx.poll.findUnique({
          where: { id: pollId },
          select: POLL_SELECT,
        });
        if (current === null) {
          throw new DomainError("NOT_FOUND");
        }
        return work(tx, current, event.status);
      });
    } catch (error) {
      // The database's own guard on one open poll per event.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DomainError("POLL_ALREADY_OPEN");
      }
      throw error;
    }
  }

  /**
   * Announces a poll's votes: at once if nothing was sent for it in the
   * last POLL_ANNOUNCE_MS, otherwise once that window ends, with the counts
   * as they are then.
   */
  private announce(eventId: string, pollId: string): void {
    const pending = this.announcing.get(pollId);
    if (pending !== undefined) {
      pending.again = true;
      return;
    }
    const window = { again: false };
    this.announcing.set(pollId, window);
    void this.sendCurrent(eventId, pollId);
    const timer = setTimeout(() => {
      this.announcing.delete(pollId);
      if (window.again) {
        this.announce(eventId, pollId);
      }
    }, POLL_ANNOUNCE_MS);
    timer.unref();
  }

  private async sendCurrent(eventId: string, pollId: string): Promise<void> {
    try {
      const row = await this.prisma.poll.findUnique({
        where: { id: pollId },
        select: POLL_SELECT,
      });
      if (row !== null) {
        this.send(eventId, toPoll(row));
      }
    } catch (error) {
      // A missed announcement is corrected by the next, or by a rejoin.
      this.logger.warn({ err: error, pollId }, "Poll announcement failed");
    }
  }

  private send(eventId: string, poll: Poll): void {
    this.fanout.toEvent(eventId, "poll.updated", { poll });
  }
}

/** The participant, or the error their refusal stands for. */
function requireParticipant(access: Authorization): Participant {
  if (access.ok) {
    return access.participant;
  }
  throw new DomainError(
    access.error === "CLOSED" ? "INTERACTION_CLOSED" : access.error,
  );
}
