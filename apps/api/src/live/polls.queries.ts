import type { Prisma } from "../generated/prisma/client.js";

/**
 * Closes the event's open poll, in the caller's transaction: as the event
 * completes or is cancelled, interaction ends (FR-RN-8). Clients reload
 * their polls when the event's status changes.
 */
export async function closeOpenPolls(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<void> {
  await tx.poll.updateMany({
    where: { eventId, status: "OPEN" },
    data: {
      status: "CLOSED",
      closedAt: now,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
}
