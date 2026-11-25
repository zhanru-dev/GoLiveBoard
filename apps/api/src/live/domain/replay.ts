/** The most journal entries one join replays (docs/04, section 4). */
export const REPLAY_LIMIT = 500;

export type ReplayPlan =
  /** The client has everything. */
  | { readonly kind: "UP_TO_DATE" }
  /** Send the entries after `afterSequence`, up to `latestSequence`. */
  | { readonly kind: "REPLAY" }
  /**
   * The client must reload the snapshot over HTTP: it is too far behind,
   * or it knows sequences the channel no longer has (the demo was reset).
   */
  | { readonly kind: "RESYNC" };

/**
 * What a client that joins a channel needs, given the last sequence it
 * applied and the channel's latest.
 */
export function replayPlan(
  afterSequence: number,
  latestSequence: number,
  limit: number = REPLAY_LIMIT,
): ReplayPlan {
  if (afterSequence > latestSequence) {
    return { kind: "RESYNC" };
  }
  if (afterSequence === latestSequence) {
    return { kind: "UP_TO_DATE" };
  }
  return latestSequence - afterSequence > limit
    ? { kind: "RESYNC" }
    : { kind: "REPLAY" };
}
