import { z } from "zod";

import { PublicEventStatus } from "./admission.js";
import { RealtimeChannel } from "./live.js";

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
  replay: z.array(ChatEvent),
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
