import type { Prisma } from "../generated/prisma/client.js";

/**
 * Writes positions 1, 2, 3… in the given order with one statement. Runs
 * under the event's row lock, so no other runbook write interleaves.
 */
export async function renumberTasks(
  tx: Prisma.TransactionClient,
  orderedIds: readonly string[],
): Promise<void> {
  const positions = orderedIds.map((_id, index) => index + 1);
  await tx.$executeRaw`
    UPDATE runbook_tasks AS task
    SET position = numbered.position
    FROM unnest(${orderedIds}::uuid[], ${positions}::int[])
      AS numbered(id, position)
    WHERE task.id = numbered.id AND task.position <> numbered.position`;
}
