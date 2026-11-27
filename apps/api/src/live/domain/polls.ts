import type { PollStatus } from "@goliveboard/contracts";

/** Only a draft can be edited, deleted or opened (FR-RN-8). */
export function isPollEditable(status: PollStatus): boolean {
  return status === "DRAFT";
}

/**
 * What decides whether a vote counts, in the order it is checked: the poll
 * must be open, and the option one of its own.
 */
export type VoteCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "POLL_NOT_OPEN" | "POLL_OPTION_INVALID";
    };

export function checkVote(
  poll: { readonly status: PollStatus; readonly optionIds: readonly string[] },
  optionId: string,
): VoteCheck {
  if (poll.status !== "OPEN") {
    return { ok: false, reason: "POLL_NOT_OPEN" };
  }
  if (!poll.optionIds.includes(optionId)) {
    return { ok: false, reason: "POLL_OPTION_INVALID" };
  }
  return { ok: true };
}

/** How long vote announcements of one poll are gathered (docs/design/polls.md). */
export const POLL_ANNOUNCE_MS = 500;
