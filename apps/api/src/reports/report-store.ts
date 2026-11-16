import { z } from "zod";

import type { Prisma } from "../generated/prisma/client.js";
import { summariseAudience } from "./domain/audience.js";

/** What `event_reports.data` holds. */
export const StoredReport = z.object({
  attended: z.number().int().nonnegative(),
  peak: z.number().int().nonnegative(),
  average: z.number().nonnegative(),
  series: z.array(
    z.object({
      minute: z.iso.datetime(),
      viewers: z.number().int().nonnegative(),
    }),
  ),
});
export type StoredReport = z.infer<typeof StoredReport>;

/**
 * Fixes the report's audience figures from the attendance minutes, once:
 * call it as the event completes, in that transaction, when no heartbeat
 * can add a minute any more (they need the event LIVE, under its lock).
 */
export async function recordReport(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<void> {
  const event = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { startsAt: true, endsAt: true },
  });
  const [minutes, [attended]] = await Promise.all([
    tx.$queryRaw<{ minute: Date; viewers: number }[]>`
      SELECT minute, count(*)::int AS viewers FROM attendance_minutes
      WHERE event_id = ${eventId}::uuid
      GROUP BY minute ORDER BY minute`,
    tx.$queryRaw<{ attended: number }[]>`
      SELECT count(DISTINCT attendee_id)::int AS attended
      FROM attendance_minutes WHERE event_id = ${eventId}::uuid`,
  ]);
  const audience = summariseAudience(minutes, event.startsAt, event.endsAt);
  const data: StoredReport = {
    attended: attended?.attended ?? 0,
    peak: audience.peak,
    average: audience.average,
    series: audience.series.map(({ minute, viewers }) => ({
      minute: minute.toISOString(),
      viewers,
    })),
  };
  await tx.$executeRaw`
    INSERT INTO event_reports (event_id, generated_at, data)
    VALUES (${eventId}::uuid, ${now}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (event_id) DO NOTHING`;
}
