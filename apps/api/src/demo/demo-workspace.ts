import type { Prisma } from "../generated/prisma/client.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "./demo-accounts.js";

/**
 * Anyone can sign in to the demo workspace, so what one visitor can make it
 * do is bounded (FR-AUTH-5): it holds at most this many events until the
 * nightly reset. The seed has four.
 */
export const DEMO_EVENT_LIMIT = 40;

/**
 * And at most this many holding slates, uploaded or waiting for their
 * upload: each can hold up to 5 MB.
 */
export const DEMO_ASSET_LIMIT = 50;

/**
 * And at most this many attendees across its events: anyone can register,
 * from any address.
 */
export const DEMO_ATTENDEE_LIMIT = 200;

/**
 * Every demo sign-in starts a session for the same person. The newest this
 * many are kept; the oldest visitor's session ends when one more arrives, so
 * the table stays bounded however many visitors come (a visitor signed out
 * this way clicks Try the demo again).
 */
export const DEMO_SESSION_LIMIT = 1_000;

/** Seeding, resetting and creating demo events take turns, in every process. */
const DEMO_LOCK_KEY = "demo-workspace";
/** Demo sign-ins take turns, so the limit is exact. */
const DEMO_SESSIONS_LOCK_KEY = "demo-sessions";

export function isDemoWorkspace(workspaceId: string): boolean {
  return workspaceId === DEMO_WORKSPACE.id;
}

/**
 * Takes the demo workspace's lock until the transaction ends.
 *
 * Edits and everything added to an existing event already wait for a reset:
 * they lock the event's row, which the reset deletes. A new event locks
 * nothing the reset touches, so without this lock a create still in flight
 * when the reset deletes the events would commit afterwards and survive it.
 */
export async function lockDemoWorkspace(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${DEMO_LOCK_KEY}, 0))`;
}

/**
 * Before an event is created in `workspaceId`: in the demo workspace, waits
 * for a reset in progress (or holds the next one back until this create
 * commits) and refuses once the workspace is full. Other workspaces pass
 * straight through.
 *
 * @throws DomainError `DEMO_RESTRICTED` when the demo holds DEMO_EVENT_LIMIT
 * events
 */
export async function claimDemoEventSlot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  if (!isDemoWorkspace(workspaceId)) {
    return;
  }
  await lockDemoWorkspace(tx);
  const events = await tx.event.count({ where: { workspaceId } });
  if (events >= DEMO_EVENT_LIMIT) {
    throw new DomainError("DEMO_RESTRICTED", {
      detail: `The demo holds at most ${String(DEMO_EVENT_LIMIT)} events. It is reset every night.`,
    });
  }
}

/**
 * Before an upload link is handed out in `workspaceId`: in the demo
 * workspace, the same as claimDemoEventSlot, for holding slates. Call it
 * before locking the event: the reset takes the demo lock first and then
 * waits for the event's row, so taking them the other way round deadlocks.
 *
 * @throws DomainError `DEMO_RESTRICTED` when the demo holds DEMO_ASSET_LIMIT
 * slates
 */
export async function claimDemoAssetSlot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  if (!isDemoWorkspace(workspaceId)) {
    return;
  }
  await lockDemoWorkspace(tx);
  const assets = await tx.asset.count({ where: { event: { workspaceId } } });
  if (assets >= DEMO_ASSET_LIMIT) {
    throw new DomainError("DEMO_RESTRICTED", {
      detail: `The demo holds at most ${String(DEMO_ASSET_LIMIT)} uploads. It is reset every night.`,
    });
  }
}

/**
 * Before an attendee is added in `workspaceId`: in the demo workspace, takes
 * the demo lock (so the reset waits for the registration, or the other way
 * round) and says whether there is room for one more attendee. Other
 * workspaces always have room.
 *
 * A full demo is not an error: the registration answers like any other, so
 * the response still says nothing about the address (FR-AD-3).
 */
export async function demoHasRoomForAttendee(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<boolean> {
  if (!isDemoWorkspace(workspaceId)) {
    return true;
  }
  await lockDemoWorkspace(tx);
  const attendees = await tx.attendee.count({
    where: { event: { workspaceId } },
  });
  return attendees < DEMO_ATTENDEE_LIMIT;
}

/**
 * Stream checks fetch the URL a Manager enters, every 30 seconds. Anyone can
 * be the demo's Manager, so in the demo nobody can enter one: it would let
 * strangers point the demo's requests at any public site.
 *
 * @throws DomainError `DEMO_RESTRICTED` in the demo workspace
 */
export function assertNotDemoStream(workspaceId: string): void {
  if (isDemoWorkspace(workspaceId)) {
    throw new DomainError("DEMO_RESTRICTED", {
      detail:
        "Stream checks are switched off in the demo, because they send requests to the address entered.",
    });
  }
}

/**
 * Called by a demo sign-in, in the transaction that created its session:
 * deletes the demo visitor's sessions that have ended (expired or revoked)
 * and, beyond DEMO_SESSION_LIMIT, the oldest.
 */
export async function limitDemoSessions(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${DEMO_SESSIONS_LOCK_KEY}, 0))`;
  const visitor = DEMO_PEOPLE.manager.id;
  await tx.$executeRaw`
    DELETE FROM sessions
    WHERE user_id = ${visitor}::uuid
      AND (
        refresh_expires_at <= ${now}
        OR revoked_at IS NOT NULL
        OR id NOT IN (
          SELECT id FROM sessions
          WHERE user_id = ${visitor}::uuid
            AND refresh_expires_at > ${now} AND revoked_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT ${DEMO_SESSION_LIMIT}
        )
      )`;
}
