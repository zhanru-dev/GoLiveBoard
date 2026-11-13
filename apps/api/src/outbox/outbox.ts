import type { Prisma } from "../generated/prisma/client.js";

export interface OutboxEntry {
  readonly workspaceId: string;
  /** One of the message types in packages/contracts (OutboxMessageType). */
  readonly type: string;
  readonly payload: Prisma.InputJsonObject;
}

/**
 * Records a side effect to perform after the change commits (ADR-0007).
 * Takes the transaction client on purpose: the message exists if and only if
 * the change does. The worker's relay picks it up within a second.
 */
export async function writeOutbox(
  tx: Prisma.TransactionClient,
  entry: OutboxEntry,
): Promise<void> {
  await tx.outboxMessage.create({
    data: {
      workspaceId: entry.workspaceId,
      type: entry.type,
      payload: entry.payload,
    },
  });
}
