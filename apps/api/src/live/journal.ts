import type {
  ChatEvent,
  ChatEventKind,
  QuestionsEvent,
  RealtimeChannel,
} from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";
import { CHAT_MESSAGE_SELECT, toChatMessage } from "./chat-view.js";
import type { QuestionViewer } from "./domain/questions.js";
import { REPLAY_LIMIT } from "./domain/replay.js";
import { QUESTION_SELECT, questionsEventFor } from "./question-view.js";

type Client = Prisma.TransactionClient;

/** The last sequence an event's channel has given out. */
export async function latestSequence(
  client: Client,
  eventId: string,
  channel: RealtimeChannel,
): Promise<number> {
  const event = await client.event.findUnique({
    where: { id: eventId },
    select: { chatSequence: true, questionsSequence: true },
  });
  if (event === null) {
    return 0;
  }
  return Number(
    channel === "CHAT" ? event.chatSequence : event.questionsSequence,
  );
}

/**
 * What happened on the event's chat after `afterSequence`, up to and
 * including `upTo`, in order: each entry with the message as it is now (a
 * message deleted since shows as deleted already; its own MESSAGE_DELETED
 * entry follows).
 */
export async function chatReplay(
  client: Client,
  eventId: string,
  afterSequence: number,
  upTo: number,
): Promise<ChatEvent[]> {
  const entries = await client.realtimeJournal.findMany({
    where: {
      eventId,
      channel: "CHAT",
      sequence: { gt: afterSequence, lte: upTo },
    },
    orderBy: { sequence: "asc" },
    take: REPLAY_LIMIT,
    select: { sequence: true, kind: true, entityId: true },
  });
  const messages = await client.chatMessage.findMany({
    where: { id: { in: [...new Set(entries.map((entry) => entry.entityId))] } },
    select: CHAT_MESSAGE_SELECT,
  });
  const byId = new Map(messages.map((row) => [row.id, toChatMessage(row)]));
  return entries.flatMap((entry) => {
    const message = byId.get(entry.entityId);
    // A message is never deleted outright while its event exists; skip
    // defensively rather than send a hole.
    return message === undefined
      ? []
      : [
          {
            sequence: Number(entry.sequence),
            kind: entry.kind as ChatEventKind,
            message,
          },
        ];
  });
}

/**
 * What happened on the event's Q&A after `afterSequence`, as this viewer
 * sees it: each entry with the question as it is now, or WITHDRAWN where
 * they may not see it (so the sequence has no gap).
 */
export async function questionsReplay(
  client: Client,
  eventId: string,
  afterSequence: number,
  upTo: number,
  viewer: QuestionViewer,
): Promise<QuestionsEvent[]> {
  const entries = await client.realtimeJournal.findMany({
    where: {
      eventId,
      channel: "QUESTIONS",
      sequence: { gt: afterSequence, lte: upTo },
    },
    orderBy: { sequence: "asc" },
    take: REPLAY_LIMIT,
    select: { sequence: true, kind: true, entityId: true },
  });
  const questions = await client.question.findMany({
    where: { id: { in: [...new Set(entries.map((entry) => entry.entityId))] } },
    select: QUESTION_SELECT,
  });
  const byId = new Map(questions.map((row) => [row.id, row]));
  return entries.map((entry) => {
    const row = byId.get(entry.entityId);
    const sequence = Number(entry.sequence);
    return row === undefined
      ? { sequence, kind: "WITHDRAWN", questionId: entry.entityId }
      : questionsEventFor(viewer, sequence, entry.kind, row);
  });
}
