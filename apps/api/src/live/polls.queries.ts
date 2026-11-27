import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Closes the event's open poll, in the caller's transaction: as the event
 * completes or is cancelled, interaction ends (FR-RN-8). Audited as a close
 * by whoever moved the event. Clients reload their polls when the event's
 * new status reaches them (usePolls), so nothing is announced here.
 */
export async function closeOpenPolls(
  tx: Prisma.TransactionClient,
  actor: Actor,
  eventId: string,
  because: "COMPLETED" | "CANCELLED",
  now: Date,
): Promise<void> {
  // At most one, by the database's own guard.
  const open = await tx.poll.findFirst({
    where: { eventId, status: "OPEN" },
    select: { id: true, options: { select: { voteCount: true } } },
  });
  if (open === null) {
    return;
  }
  await tx.poll.update({
    where: { id: open.id },
    data: {
      status: "CLOSED",
      closedAt: now,
      version: { increment: 1 },
      updatedAt: now,
    },
  });
  await recordAudit(tx, actor, {
    action: "poll.closed",
    targetType: "poll",
    targetId: open.id,
    eventId,
    after: {
      totalVotes: open.options.reduce(
        (sum, { voteCount }) => sum + voteCount,
        0,
      ),
      because: `event ${because.toLowerCase()}`,
    },
  });
}
