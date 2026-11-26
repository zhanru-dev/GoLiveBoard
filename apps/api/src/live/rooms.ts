import type { RealtimeChannel } from "@goliveboard/contracts";

/**
 * What a recheck is about: every connection whose access could depend on
 * the thing that changed. Each scope has a Socket.IO room per ID.
 */
export const RECHECK_SCOPES = [
  "event",
  "workspace",
  "attendee",
  "attendee-session",
  "user",
  "session",
] as const;
export type RecheckScope = (typeof RECHECK_SCOPES)[number];

/** The room of every connection in a scope's ID. */
export const scopeRoom = (scope: RecheckScope, id: string) => `${scope}:${id}`;

/** The room that receives one channel's live events. */
export const channelRoom = (eventId: string, channel: RealtimeChannel) =>
  `event:${eventId}:${channel}`;

/** Moderators on an event's Q&A: they see pending and hidden questions. */
export const moderatorsRoom = (eventId: string) =>
  `${channelRoom(eventId, "QUESTIONS")}:moderators`;

/**
 * One author on an event's Q&A, who sees their own pending and hidden
 * questions. `authorKey` is `attendee:<id>` or `user:<id>`.
 */
export const authorRoom = (eventId: string, authorKey: string) =>
  `${channelRoom(eventId, "QUESTIONS")}:author:${authorKey}`;
