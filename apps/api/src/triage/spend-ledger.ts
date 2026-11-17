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
