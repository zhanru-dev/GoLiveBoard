import type { Prisma } from "../generated/prisma/client.js";
import type { Spent } from "./domain/budget.js";

/** A UK calendar day as the `date` column stores it. */
export function dayValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Locks the workspace's spend row for the day (creating it), so budget
 * checks run one at a time, and returns what it holds.
 */
export async function lockDay(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  day: string,
): Promise<Spent> {
  await tx.$executeRaw`
    INSERT INTO triage_spend (workspace_id, day) VALUES (${workspaceId}::uuid, ${dayValue(day)})
    ON CONFLICT DO NOTHING`;
  const [row] = await tx.$queryRaw<
    { runs: number; spent_micros: bigint; reserved_micros: bigint }[]
  >`
    SELECT runs, spent_micros, reserved_micros FROM triage_spend
    WHERE workspace_id = ${workspaceId}::uuid AND day = ${dayValue(day)}
    FOR UPDATE`;
  return {
    runs: row?.runs ?? 0,
    spentMicros: Number(row?.spent_micros ?? 0),
    reservedMicros: Number(row?.reserved_micros ?? 0),
  };
}

/** Counts a run for the day and holds its worst cost while it runs. */
export async function reserve(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  day: string,
  micros: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE triage_spend
    SET runs = runs + 1, reserved_micros = reserved_micros + ${micros}
    WHERE workspace_id = ${workspaceId}::uuid AND day = ${dayValue(day)}`;
}

/**
 * Turns a finished run's reservation into what it cost, on the day it was
 * counted in. Call it in the transaction that finishes the run, once.
 */
export async function settle(
  tx: Prisma.TransactionClient,
  runId: string,
  spentMicros: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE triage_spend AS spend
    SET reserved_micros = greatest(spend.reserved_micros - run.reserved_micros, 0),
        spent_micros = spend.spent_micros + ${spentMicros}
    FROM triage_runs AS run
    JOIN events AS event ON event.id = run.event_id
    WHERE run.id = ${runId}::uuid
      AND spend.workspace_id = event.workspace_id
      AND spend.day = run.spend_day`;
}

/**
 * Counts as spent what runs deleted unsettled still hold (their event was
 * deleted while they ran, as the demo's reset does): they may have been
 * billed. One statement, so the day's reservations and its active runs are
 * read from one snapshot, and the change is applied relative to the row as
 * it is then: a reservation made or settled meanwhile is kept.
 *
 * @returns how many days it corrected
 */
export function settleOrphans(prisma: {
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
}): Promise<number> {
  return prisma.$executeRaw`
    UPDATE triage_spend AS spend
    SET reserved_micros = spend.reserved_micros - orphaned.micros,
        spent_micros = spend.spent_micros + orphaned.micros
    FROM (
      SELECT day_row.workspace_id, day_row.day,
             day_row.reserved_micros - coalesce(sum(run.reserved_micros), 0) AS micros
      FROM triage_spend AS day_row
      LEFT JOIN events AS event ON event.workspace_id = day_row.workspace_id
      LEFT JOIN triage_runs AS run
        ON run.event_id = event.id
       AND run.spend_day = day_row.day
       AND run.status IN ('QUEUED', 'RUNNING')
      WHERE day_row.reserved_micros > 0
      GROUP BY day_row.workspace_id, day_row.day, day_row.reserved_micros
    ) AS orphaned
    WHERE spend.workspace_id = orphaned.workspace_id
      AND spend.day = orphaned.day
      AND orphaned.micros > 0`;
}
