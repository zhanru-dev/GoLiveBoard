import type { Prisma } from "../generated/prisma/client.js";

/** Whether the event has a live (unrevoked) invitation for this address. */
export async function hasLiveInvitation(
  client: Prisma.TransactionClient,
  eventId: string,
  email: string,
): Promise<boolean> {
  const invitation = await client.attendeeInvitation.findFirst({
    where: { eventId, email, revokedAt: null },
    select: { id: true },
  });
  return invitation !== null;
}
