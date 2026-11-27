import type { Poll } from "@goliveboard/contracts";

import type { Prisma } from "../generated/prisma/client.js";

/** What a poll is read with, to show it. */
export const POLL_SELECT = {
  id: true,
  eventId: true,
  question: true,
  status: true,
  version: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  options: {
    select: { id: true, label: true, voteCount: true },
    orderBy: { position: "asc" },
  },
} as const satisfies Prisma.PollSelect;

export type PollRow = Prisma.PollGetPayload<{ select: typeof POLL_SELECT }>;

/** A poll as everyone who may see it sees it; `myOptionId` for an attendee. */
export function toPoll(row: PollRow, myOptionId?: string | null): Poll {
  const options = row.options.map((option) => ({
    id: option.id,
    label: option.label,
    votes: option.voteCount,
  }));
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    options,
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
    version: row.version,
    openedAt: row.openedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(myOptionId === undefined ? {} : { myOptionId }),
  };
}
