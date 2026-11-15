import { z } from "zod";

import { PublicEventStatus } from "./admission.js";
import { QuestionStatus, RealtimeChannel } from "./live.js";

/**
 * The real-time protocol (docs/04, section 4): Socket.IO on `/realtime`,
 * WebSocket only. Events are named by their slug, which never changes and
 * which attendees already know; internal IDs stay private.
 */
export const REALTIME_PATH = "/realtime";

export const Slug = z.string().min(1).max(100);

/** A position on one channel of an event. */
export const Sequence = z.number().int().nonnegative();

/** Why the server refused a message; clients switch on the code. */
export const RealtimeErrorCode = z.enum([
  /** Not signed in, or the session has ended. */
  "UNAUTHENTICATED",
  /** Signed in, but not admitted to this event (any more). */
  "FORBIDDEN",
  /** No such event, as far as this person can tell. */
  "NOT_FOUND",
  /** The event takes no messages now (e.g. it has ended). */
  "CLOSED",
  /** The message did not match its schema. */
  "INVALID",
  /** Too far behind: reload the snapshot over HTTP, then join again. */
  "RESYNC_REQUIRED",
  "RATE_LIMITED",
  /** Something failed on the server; retrying later may work. */
  "UNAVAILABLE",
]);
export type RealtimeErrorCode = z.infer<typeof RealtimeErrorCode>;

export const RealtimeFailure = z.object({
  ok: z.literal(false),
  error: RealtimeErrorCode,
});
export type RealtimeFailure = z.infer<typeof RealtimeFailure>;

/** Who wrote a message, as everyone sees it. */
export const ChatAuthor = z.object({
  kind: z.enum(["ATTENDEE", "STAFF"]),
  name: z.string(),
});
export type ChatAuthor = z.infer<typeof ChatAuthor>;

/** A chat message (FR-RN-2); a deleted one keeps its place, without text. */
export const ChatMessage = z.object({
  id: z.uuid(),
  sequence: Sequence,
  author: ChatAuthor,
  body: z.string(),
  deleted: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatEventKind = z.enum(["MESSAGE_CREATED", "MESSAGE_DELETED"]);
export type ChatEventKind = z.infer<typeof ChatEventKind>;

/** server → client `chat.event`, and the entries of a CHAT replay. */
export const ChatEvent = z.object({
  sequence: Sequence,
  kind: ChatEventKind,
  message: ChatMessage,
});
export type ChatEvent = z.infer<typeof ChatEvent>;

/** What a chat message may say. */
export const ChatBody = z.string().trim().min(1).max(1000);

/**
 * client → server `chat.send`. A retry with the same `clientMessageId`
 * returns the stored message and sends nothing twice (FR-RN-2).
 */
export const ChatSend = z.object({
  slug: Slug,
  clientMessageId: z.uuid(),
  body: ChatBody,
});
export type ChatSend = z.infer<typeof ChatSend>;

export const ChatSendAck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), message: ChatMessage }),
  RealtimeFailure,
]);
export type ChatSendAck = z.infer<typeof ChatSendAck>;

/** `GET …/chat/messages`: older pages with `before`. */
export const ChatPageQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ChatPageQuery = z.infer<typeof ChatPageQuery>;

/**
 * Chat history, oldest first. With no `before`, the newest messages and the
 * channel's latest sequence: the snapshot a client loads, then joins after.
 */
export const ChatPage = z.object({
  items: z.array(ChatMessage),
  latestSequence: Sequence,
  /** Pass as `before` for the page before this one; null at the start. */
  nextBefore: Sequence.nullable(),
});
export type ChatPage = z.infer<typeof ChatPage>;

/** What a question may say. */
export const QuestionBody = z.string().trim().min(1).max(1000);

/** `POST …/questions`, with an `Idempotency-Key` to make retries safe. */
export const AskQuestionRequest = z.object({ body: QuestionBody });
export type AskQuestionRequest = z.infer<typeof AskQuestionRequest>;

/** A question for the speakers (FR-RN-4, FR-RN-5). */
export const Question = z.object({
  id: z.uuid(),
  body: z.string(),
  status: QuestionStatus,
  author: ChatAuthor,
  /** 1 to 3 while pinned (FR-RN-5). */
  pinSlot: z.int().min(1).max(3).nullable(),
  voteCount: z.int().min(0),
  /** Sent back in If-Match by moderators; votes do not change it. */
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  /**
   * Set in answers to the viewer's own requests and in lists; absent from
   * real-time events, which everyone receives alike.
   */
  mine: z.boolean().optional(),
  votedByMe: z.boolean().optional(),
});
export type Question = z.infer<typeof Question>;

export const QuestionsEventKind = z.enum([
  "CREATED",
  "UPDATED",
  "VOTED",
  "MERGED",
]);
export type QuestionsEventKind = z.infer<typeof QuestionsEventKind>;

/**
 * server → client `questions.event`, and the entries of a QUESTIONS replay.
 * A change to a question the viewer may not see (pending, or hidden) still
 * takes its place in the sequence, as WITHDRAWN: the client drops the
 * question if it has it, and sees no gap.
 */
export const QuestionsEvent = z.union([
  z.object({
    sequence: Sequence,
    kind: QuestionsEventKind,
    question: Question,
  }),
  z.object({
    sequence: Sequence,
    kind: z.literal("WITHDRAWN"),
    /**
     * The question to drop. Absent when it was never public: the viewer has
     * nothing of it to drop, and learns only that the sequence moved.
     */
    questionId: z.uuid().optional(),
  }),
]);
export type QuestionsEvent = z.infer<typeof QuestionsEvent>;

/**
 * `GET …/questions`: the questions the viewer may see, pinned first, then by
 * votes, with the latest sequence to join after.
 */
export const QuestionList = z.object({
  items: z.array(Question),
  latestSequence: Sequence,
});
export type QuestionList = z.infer<typeof QuestionList>;

/** `PATCH /questions/:id` (Managers), with If-Match. */
export const ModerateQuestionRequest = z
  .object({ status: QuestionStatus, pinned: z.boolean() })
  .partial()
  .refine(
    (change) => change.status !== undefined || change.pinned !== undefined,
    {
      error: "Change the status, the pin, or both",
    },
  );
export type ModerateQuestionRequest = z.infer<typeof ModerateQuestionRequest>;

/** client → server `channel.join`. */
export const ChannelJoin = z.object({
  slug: Slug,
  channel: RealtimeChannel,
  /** The last sequence the client applied; 0 for none. */
  afterSequence: Sequence,
});
export type ChannelJoin = z.infer<typeof ChannelJoin>;

/**
 * The ack of `channel.join`: what the client missed (at most 500 entries),
 * then live events. Live events can arrive before this ack; the client holds
 * them until it has applied the replay, and ignores any sequence it has.
 */
export const ChannelJoined = z.object({
  ok: z.literal(true),
  latestSequence: Sequence,
  /** Chat events on CHAT, question events on QUESTIONS. */
  replay: z.array(z.union([ChatEvent, QuestionsEvent])),
});
export type ChannelJoined = z.infer<typeof ChannelJoined>;

export const ChannelJoinAck = z.discriminatedUnion("ok", [
  ChannelJoined,
  RealtimeFailure,
]);
export type ChannelJoinAck = z.infer<typeof ChannelJoinAck>;

/** client → server `channel.leave`. */
export const ChannelLeave = z.object({
  slug: Slug,
  channel: RealtimeChannel,
});
export type ChannelLeave = z.infer<typeof ChannelLeave>;

/** server → client `event.status`: switches the watch page to the stream. */
export const EventStatusChanged = z.object({
  slug: Slug,
  status: PublicEventStatus,
});
export type EventStatusChanged = z.infer<typeof EventStatusChanged>;

/**
 * `GET /public/events/:slug/watch`: what the watch page shows (FR-RN-1).
 * The stream's address is given only while the event is live.
 */
export const WatchInfo = z.object({
  slug: Slug,
  title: z.string(),
  status: PublicEventStatus,
  streamUrl: z.string().nullable(),
  /** The holding slate, with a short-lived link. */
  slate: z.object({ url: z.url(), expiresAt: z.iso.datetime() }).nullable(),
});
export type WatchInfo = z.infer<typeof WatchInfo>;

/**
 * client → server `watch.heartbeat`, every 30 seconds while an attendee
 * watches a live event: the operations room's audience (FR-RN-7).
 */
export const WatchHeartbeat = z.object({ slug: Slug });
export type WatchHeartbeat = z.infer<typeof WatchHeartbeat>;

/** server → client `session.revoked`, sent just before the server disconnects. */
export const SessionRevoked = z.object({
  reason: z.enum([
    /** The session ended: signed out, expired or revoked. */
    "SIGNED_OUT",
    /** The session goes on, but no longer admits this person to an event. */
    "ACCESS_REVOKED",
  ]),
});
export type SessionRevoked = z.infer<typeof SessionRevoked>;
