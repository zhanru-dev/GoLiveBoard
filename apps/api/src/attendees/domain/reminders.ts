import type { EventStatus } from "@opspilot/contracts";

/** The reminders an attendee receives (FR-AD-5). */
export type ReminderKind = "DAY_BEFORE" | "HOUR_BEFORE";

const HOUR_MS = 60 * 60 * 1000;

/** How long before the start each reminder is due. */
export const REMINDER_LEAD_MS: Readonly<Record<ReminderKind, number>> = {
  DAY_BEFORE: 24 * HOUR_MS,
  HOUR_BEFORE: HOUR_MS,
};

/**
 * The reminder due at `now` for an event starting at `startsAt`, if any.
 *
 * The day-before reminder is due from 24 hours before the start until the
 * hour-before one takes over; the hour-before one until the start. Someone
 * who registers 30 minutes before the start therefore gets only the
 * hour-before reminder, and nobody gets a reminder for an event that has
 * started.
 */
export function dueReminder(
  startsAt: Date,
  now: Date,
): ReminderKind | undefined {
  const untilStart = startsAt.getTime() - now.getTime();
  if (untilStart <= 0) {
    return undefined;
  }
  if (untilStart <= REMINDER_LEAD_MS.HOUR_BEFORE) {
    return "HOUR_BEFORE";
  }
  if (untilStart <= REMINDER_LEAD_MS.DAY_BEFORE) {
    return "DAY_BEFORE";
  }
  return undefined;
}

/** Reminders go out only for an event that is still going to happen. */
export function isRemindable(status: EventStatus): boolean {
  return status === "CONFIGURING" || status === "READY";
}
