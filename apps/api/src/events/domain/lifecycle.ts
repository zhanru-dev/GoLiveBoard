import type { EventStatus } from "@goliveboard/contracts";

/**
 * What a transition needs besides being in the table. Moving to `READY` or
 * `LIVE` also needs a readiness assessment with no hard blockers (FR-LC-3).
 */
export type TransitionGate = "NONE" | "NO_HARD_BLOCKERS";

/**
 * The event lifecycle (FR-EV-2, docs/03 section 2) as data: for each status,
 * the statuses it may move to and the gate each move must pass. Anything not
 * listed is illegal. `CANCELLED` is reachable from every status before `LIVE`.
 */
export const TRANSITIONS: Readonly<
  Record<EventStatus, Readonly<Partial<Record<EventStatus, TransitionGate>>>>
> = {
  DRAFT: { CONFIGURING: "NONE", CANCELLED: "NONE" },
  CONFIGURING: { READY: "NO_HARD_BLOCKERS", CANCELLED: "NONE" },
  READY: { CONFIGURING: "NONE", LIVE: "NO_HARD_BLOCKERS", CANCELLED: "NONE" },
  LIVE: { COMPLETED: "NONE" },
  COMPLETED: { ARCHIVED: "NONE" },
  CANCELLED: { ARCHIVED: "NONE" },
  ARCHIVED: {},
};

export type TransitionPlan =
  | { readonly allowed: false }
  | { readonly allowed: true; readonly gate: TransitionGate };

/**
 * Decides whether an event in `from` may move to `to`, and what the move must
 * check first.
 *
 * @param from - the event's current status, read under a row lock
 * @param to - the status requested
 * @returns `{ allowed: false }` for any move the table does not list,
 * including a move to the current status
 */
export function planTransition(
  from: EventStatus,
  to: EventStatus,
): TransitionPlan {
  const gate = TRANSITIONS[from][to];
  return gate === undefined ? { allowed: false } : { allowed: true, gate };
}

/** The statuses an event in `from` may move to, in table order. */
export function allowedTransitions(from: EventStatus): EventStatus[] {
  return Object.keys(TRANSITIONS[from]) as EventStatus[];
}

/**
 * FR-EV-4: an archived event, and everything that belongs to it, can only be
 * read.
 */
export function isReadOnly(status: EventStatus): boolean {
  return status === "ARCHIVED";
}
