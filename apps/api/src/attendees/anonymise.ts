import { randomBytes } from "node:crypto";

import type { Prisma } from "../generated/prisma/client.js";
import { anonymisedEmail, FORMER_ATTENDEE_NAME } from "./domain/privacy.js";

/**
 * Anonymises one attendee (FR-AD-6, docs/03 section 8), on request or when
 * the retention period ends: the name becomes "Former attendee", the address
 * a random placeholder, and everything that could reach or identify them
 * goes: sessions, links, demo inbox mail, and the event's invitations for
 * their address. The row stays, so counts and authorship do.
 *
 * The caller holds the attendee's row lock (and, by the usual order, the
 * event's first). Does nothing for an attendee already erased.
 *
 * @returns whether the attendee was anonymised now
 */
export async function anonymiseAttendee(
  tx: Prisma.TransactionClient,
  attendeeId: string,
  now: Date,
): Promise<boolean> {
  const attendee = await tx.attendee.findUniqueOrThrow({
    where: { id: attendeeId },
    select: { eventId: true, email: true, status: true },
  });
  if (attendee.status === "ERASED") {
    return false;
  }
  await tx.attendeeInvitation.deleteMany({
    where: { eventId: attendee.eventId, email: attendee.email },
  });
  await tx.attendeeSession.deleteMany({ where: { attendeeId } });
  await tx.attendeeVerificationToken.deleteMany({ where: { attendeeId } });
  await tx.demoInboxMessage.deleteMany({ where: { attendeeId } });
  await tx.attendee.update({
    where: { id: attendeeId },
    data: {
      name: FORMER_ATTENDEE_NAME,
      email: anonymisedEmail(randomBytes(16).toString("hex")),
      status: "ERASED",
      erasedAt: now,
      remindersOptIn: false,
      demoInboxKeyHash: null,
      updatedAt: now,
    },
  });
  return true;
}

/**
 * Ends an attendee's access (FR-AD-4): their sessions stop working at once,
 * and their unused links too. The caller holds the attendee's row lock.
 *
 * @returns whether the attendee was revoked now
 */
export async function revokeAttendee(
  tx: Prisma.TransactionClient,
  attendeeId: string,
  now: Date,
): Promise<boolean> {
  const { count } = await tx.attendee.updateMany({
    where: { id: attendeeId, status: { in: ["PENDING", "VERIFIED"] } },
    data: { status: "REVOKED", revokedAt: now, updatedAt: now },
  });
  await tx.attendeeSession.deleteMany({ where: { attendeeId } });
  await tx.attendeeVerificationToken.deleteMany({
    where: { attendeeId, usedAt: null },
  });
  return count > 0;
}
