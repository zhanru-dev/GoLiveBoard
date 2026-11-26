import { Inject, Injectable } from "@nestjs/common";
import {
  type ChatEvent,
  type ChatMessage,
  type ChatPage,
  type ChatPageQuery,
  ChatSend,
  type ChatSendAck,
  type RealtimeFailure,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import {
  demoHasRoomForChatMessage,
  isDemoWorkspace,
} from "../demo/demo-workspace.js";
import {
  lockEventById,
  lockWritableEvent,
} from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { CHAT_MESSAGE_SELECT, toChatMessage } from "./chat-view.js";
import { Fanout } from "./fanout.js";
import {
  canWrite,
  type Identity,
  type Participant,
  Participants,
} from "./participants.js";

const failure = (error: RealtimeFailure["error"]): RealtimeFailure => ({
  ok: false,
  error,
});

/** Who is sending, as the gateway knows the connection. */
export interface Sender {
  readonly identity: Identity;
  readonly connectionId: string;
  readonly ip: string;
}

/** Live chat (FR-RN-2, FR-RN-3). */
@Injectable()
export class ChatService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly participants: Participants,
    private readonly rateLimiter: RateLimiter,
    private readonly fanout: Fanout,
  ) {}

  /**
   * Stores a message and sends it to everyone on the event's chat.
   *
   * - A retry with the same client message ID returns the stored message
   *   and sends nothing again.
   * - The decision is made again under the event's row lock, which every
   *   change to who may take part also takes (revocation, policy, status):
   *   one that commits first is seen, so no message slips in after it.
   * - The sequence comes from the event's row, in the same transaction as
   *   the message and its journal entry: gapless and unique.
   */
  async send(sender: Sender, payload: unknown): Promise<ChatSendAck> {
    const parsed = ChatSend.safeParse(payload);
    if (!parsed.success) {
      return failure("INVALID");
    }
    const { slug, clientMessageId, body } = parsed.data;
    const first = await this.decide(sender, { slug });
    if (!first.ok) {
      return first;
    }
    const { eventId, workspaceId } = first.participant;
    const author = authorOf(first.participant);
    const stored = await this.findSent(
      this.prisma,
      eventId,
      author,
      clientMessageId,
    );
    if (stored !== undefined) {
      return { ok: true, message: stored };
    }
    try {
      await this.countAgainstLimits(first.participant, sender.ip);
    } catch (error) {
      if (error instanceof DomainError) {
        return failure(
          error.code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE",
        );
      }
      throw error;
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!(await lockEventById(tx, eventId))) {
        return { kind: "refused" as const, ack: failure("NOT_FOUND") };
      }
      const decision = await this.decide(sender, { id: eventId }, tx);
      if (!decision.ok) {
        return { kind: "refused" as const, ack: decision };
      }
      // Under the lock, a retry that raced this one has committed.
      const raced = await this.findSent(tx, eventId, author, clientMessageId);
      if (raced !== undefined) {
        return { kind: "stored" as const, message: raced };
      }
      if (!(await demoHasRoomForChatMessage(tx, workspaceId, eventId))) {
        return { kind: "refused" as const, ack: failure("RATE_LIMITED") };
      }
      const sequence = await nextChatSequence(tx, eventId);
      const created = await tx.chatMessage.create({
        data: {
          eventId,
          sequence,
          clientMessageId,
          body,
          authorAttendeeId: author.attendeeId,
          authorUserId: author.userId,
        },
        select: CHAT_MESSAGE_SELECT,
      });
      await tx.realtimeJournal.create({
        data: {
          eventId,
          channel: "CHAT",
          sequence,
          kind: "MESSAGE_CREATED",
          entityId: created.id,
        },
      });
      return { kind: "created" as const, message: toChatMessage(created) };
    });
    if (outcome.kind === "refused") {
      return outcome.ack;
    }
    if (outcome.kind === "created") {
      this.broadcast(eventId, "MESSAGE_CREATED", outcome.message);
    }
    return { ok: true, message: outcome.message };
  }

  /**
   * Removes a message's text for everyone, keeping its place as a tombstone,
   * and records who did it (FR-RN-3). Deleting it again changes nothing.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`
   */
  async delete(
    actor: Actor,
    eventId: string,
    messageId: string,
  ): Promise<ChatMessage> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const message = await tx.chatMessage.findFirst({
        where: { id: messageId, eventId },
        select: { id: true, deletedAt: true },
      });
      if (message === null) {
        throw new DomainError("NOT_FOUND");
      }
      if (message.deletedAt !== null) {
        return {
          deleted: false,
          message: toChatMessage(
            await tx.chatMessage.findUniqueOrThrow({
              where: { id: messageId },
              select: CHAT_MESSAGE_SELECT,
            }),
          ),
        };
      }
      const now = this.clock.now();
      const sequence = await nextChatSequence(tx, eventId);
      const updated = await tx.chatMessage.update({
        where: { id: messageId },
        data: { body: "", deletedAt: now, deletedById: actor.userId },
        select: CHAT_MESSAGE_SELECT,
      });
      await tx.realtimeJournal.create({
        data: {
          eventId,
          channel: "CHAT",
          sequence,
          kind: "MESSAGE_DELETED",
          entityId: messageId,
        },
      });
      // Who deleted which message; not what it said.
      await recordAudit(tx, actor, {
        action: "chat_message.deleted",
        targetType: "chat_message",
        targetId: messageId,
        eventId,
      });
      return {
        deleted: true,
        message: toChatMessage(updated),
        sequence: Number(sequence),
      };
    });
    if (outcome.deleted && outcome.sequence !== undefined) {
      this.fanout.toChat(eventId, {
        sequence: outcome.sequence,
        kind: "MESSAGE_DELETED",
        message: outcome.message,
      });
    }
    return outcome.message;
  }

  /**
   * Chat history for staff of the event's workspace, whatever its status.
   *
   * @throws DomainError `NOT_FOUND`
   */
  async historyForStaff(
    actor: Actor,
    eventId: string,
    query: ChatPageQuery,
  ): Promise<ChatPage> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    return this.history(eventId, query);
  }

  /**
   * Chat history, oldest first. The latest sequence is read first: a
   * message created after it is left out here and reaches the client when
   * it joins after that sequence.
   */
  async history(eventId: string, query: ChatPageQuery): Promise<ChatPage> {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { chatSequence: true },
    });
    const latestSequence = Number(event.chatSequence);
    const upTo =
      query.before === undefined
        ? latestSequence
        : Math.min(query.before - 1, latestSequence);
    const rows = await this.prisma.chatMessage.findMany({
      where: { eventId, sequence: { lte: upTo } },
      orderBy: { sequence: "desc" },
      take: query.limit + 1,
      select: CHAT_MESSAGE_SELECT,
    });
    const page = rows.slice(0, query.limit).reverse().map(toChatMessage);
    return {
      items: page,
      latestSequence,
      nextBefore:
        rows.length > query.limit ? (page[0]?.sequence ?? null) : null,
    };
  }

  private async decide(
    sender: Sender,
    ref: { slug: string } | { id: string },
    client?: Prisma.TransactionClient,
  ): Promise<{ ok: true; participant: Participant } | RealtimeFailure> {
    const access = await this.participants.authorize(
      sender.identity,
      ref,
      sender.connectionId,
      client,
    );
    if (!access.ok) {
      return failure(access.error);
    }
    if (!canWrite(access.participant)) {
      return failure("FORBIDDEN");
    }
    if (!access.participant.open) {
      return failure("CLOSED");
    }
    return access;
  }

  private async countAgainstLimits(
    participant: Participant,
    ip: string,
  ): Promise<void> {
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.chatMessagesPerAuthor,
      participant.attendeeId ?? participant.userId ?? ip,
    );
    if (isDemoWorkspace(participant.workspaceId)) {
      await this.rateLimiter.consumeOrThrow(RATE_LIMITS.demoWritesPerIp, ip);
      await this.rateLimiter.consumeOrThrow(
        RATE_LIMITS.demoWritesPerWorkspace,
        participant.workspaceId,
      );
    }
  }

  private async findSent(
    client: Prisma.TransactionClient,
    eventId: string,
    author: Author,
    clientMessageId: string,
  ): Promise<ChatMessage | undefined> {
    const row = await client.chatMessage.findFirst({
      where: {
        eventId,
        clientMessageId,
        ...(author.attendeeId === undefined
          ? { authorUserId: author.userId }
          : { authorAttendeeId: author.attendeeId }),
      },
      select: CHAT_MESSAGE_SELECT,
    });
    return row === null ? undefined : toChatMessage(row);
  }

  private broadcast(
    eventId: string,
    kind: ChatEvent["kind"],
    message: ChatMessage,
  ): void {
    this.fanout.toChat(eventId, {
      sequence: message.sequence,
      kind,
      message,
    });
  }
}

interface Author {
  readonly attendeeId?: string;
  readonly userId?: string;
}

function authorOf(participant: Participant): Author {
  return participant.kind === "ATTENDEE"
    ? { attendeeId: participant.attendeeId }
    : { userId: participant.userId };
}

/**
 * Takes the next sequence of an event's chat. The UPDATE locks the event's
 * row until the transaction ends, so sequences are given out one at a time.
 */
async function nextChatSequence(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ chat_sequence: bigint }[]>`
    UPDATE events SET chat_sequence = chat_sequence + 1
    WHERE id = ${eventId}::uuid
    RETURNING chat_sequence`;
  if (row === undefined) {
    throw new DomainError("NOT_FOUND");
  }
  return row.chat_sequence;
}
