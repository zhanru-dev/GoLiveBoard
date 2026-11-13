import type { Prisma } from "../generated/prisma/client.js";
import type { ReadinessInput } from "./domain/readiness.js";

/**
 * Loads what readiness depends on for one event. Called inside the
 * transition's transaction after the event row is locked, so the result
 * reflects every committed change and no conflicting change can commit
 * before the transition does.
 */
export async function loadReadinessInput(
  client: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<ReadinessInput> {
  const event = await client.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { ownerUserId: true, description: true, streamUrl: true },
  });
  const [accessPolicy, tasks, latestStreamCheck, holdingSlate] =
    await Promise.all([
      client.accessPolicy.findUnique({
        where: { eventId },
        select: { mode: true },
      }),
      client.runbookTask.findMany({
        where: { eventId },
        select: { isCritical: true, status: true },
      }),
      // Only checks of the current URL: a check of the previous URL says
      // nothing about whether the new one works.
      event.streamUrl === null
        ? null
        : client.streamCheck.findFirst({
            where: { eventId, url: event.streamUrl },
            orderBy: { checkedAt: "desc" },
            select: {
              ok: true,
              checkedAt: true,
              httpStatus: true,
              latencyMs: true,
              failure: true,
            },
          }),
      client.asset.findFirst({
        where: { eventId, kind: "HOLDING_SLATE", status: "READY" },
        select: { id: true },
      }),
    ]);
  return {
    now,
    accessPolicy,
    streamUrl: event.streamUrl,
    latestStreamCheck,
    tasks,
    holdingSlateReady: holdingSlate !== null,
    hasOwner: event.ownerUserId !== null,
    hasDescription: event.description.trim() !== "",
  };
}
