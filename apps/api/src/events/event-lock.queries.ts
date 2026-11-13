import type { EventStatus } from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { isReadOnly } from "./domain/lifecycle.js";

export interface LockedEvent {
  readonly id: string;
  readonly status: EventStatus;
}

/**
 * Locks an event row for the rest of the transaction and returns its current
 * status. Every write that depends on the event's state takes this lock
 * first: transitions, and every change to what belongs to the event (runbook,
 * access policy, stream, assets). So:
 *
 * - two transitions of one event run one after the other (two "go live"
 *   requests give one success and one `409`);
 * - a transition's readiness check sees no half-finished change to the
 *   runbook or policy, and no such change can slip in before it commits;
 * - an event cannot be archived while something is being added to it.
 *
 * `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it conflicts with itself and
 * with UPDATEs of the row, but not with the `FOR KEY SHARE` locks that
 * foreign-key checks take, so inserting a stream check or an audit entry that
 * points at the event never waits for it.
 *
 * @returns `undefined` when the event does not exist in this workspace
 */
export async function lockEvent(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  eventId: string,
): Promise<LockedEvent | undefined> {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT id, status::text AS status
    FROM events
    WHERE id = ${eventId}::uuid AND workspace_id = ${workspaceId}::uuid
    FOR NO KEY UPDATE`;
  return rows[0];
}

/**
 * Locks an event that is about to receive a change to something it owns.
 *
 * @throws DomainError `NOT_FOUND` outside the workspace, `EVENT_ARCHIVED`
 * once the event is archived (FR-EV-4)
 */
export async function lockWritableEvent(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  eventId: string,
): Promise<LockedEvent> {
  const event = await lockEvent(tx, workspaceId, eventId);
  if (event === undefined) {
    throw new DomainError("NOT_FOUND");
  }
  if (isReadOnly(event.status)) {
    throw new DomainError("EVENT_ARCHIVED");
  }
  return event;
}

/**
 * The same row lock, for the worker, which acts for no workspace. Returns
 * the stream URL as it is under the lock, so a check can tell whether the
 * URL it fetched is still the event's.
 *
 * @returns `undefined` when the event no longer exists
 */
export async function lockEventForStreamCheck(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<{ readonly streamUrl: string | null } | undefined> {
  const rows = await tx.$queryRaw<{ streamUrl: string | null }[]>`
    SELECT stream_url AS "streamUrl"
    FROM events
    WHERE id = ${eventId}::uuid
    FOR NO KEY UPDATE`;
  return rows[0];
}
