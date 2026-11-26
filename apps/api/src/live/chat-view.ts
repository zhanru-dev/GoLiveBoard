import type { ChatMessage } from "@goliveboard/contracts";

import type { Prisma } from "../generated/prisma/client.js";

/** What a chat message is read with, to show it. */
export const CHAT_MESSAGE_SELECT = {
  id: true,
  sequence: true,
  body: true,
  deletedAt: true,
  createdAt: true,
  authorAttendee: { select: { name: true } },
  authorUser: { select: { name: true } },
} as const satisfies Prisma.ChatMessageSelect;

export type ChatMessageRow = Prisma.ChatMessageGetPayload<{
  select: typeof CHAT_MESSAGE_SELECT;
}>;

/** Shown for a staff member whose account no longer exists. */
export const FORMER_STAFF_NAME = "Former staff member";

/**
 * A chat message as everyone sees it. The author's name is read with the
 * message, so an erased attendee shows as "Former attendee" everywhere.
 */
export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    author:
      row.authorAttendee === null
        ? { kind: "STAFF", name: row.authorUser?.name ?? FORMER_STAFF_NAME }
        : { kind: "ATTENDEE", name: row.authorAttendee.name },
    // A deleted message has no text left: the database requires it
    // (chat_messages_tombstone_has_no_text).
    body: row.body,
    deleted: row.deletedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
