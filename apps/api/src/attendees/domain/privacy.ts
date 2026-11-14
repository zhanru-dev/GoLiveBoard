/**
 * How long an attendee's personal data and their links last (FR-AD-3,
 * FR-AD-6, docs/03 section 8).
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A verification link works for 15 minutes (FR-AD-3). */
export const VERIFICATION_TTL_MS = 15 * MINUTE_MS;

/** What an anonymised attendee is called, in chat and everywhere else. */
export const FORMER_ATTENDEE_NAME = "Former attendee";

/**
 * The address an anonymised attendee keeps. `random` must be secret random
 * bytes, hex-encoded: nothing about the real address survives, the row stays
 * unique within its event, and the `.invalid` domain can never receive mail.
 */
export function anonymisedEmail(random: string): string {
  if (!/^[0-9a-f]{32,}$/.test(random)) {
    throw new Error("Anonymised addresses need at least 16 random bytes");
  }
  return `${random}@anonymised.invalid`;
}

/**
 * When an attendee's personal data must be gone: the event's end plus the
 * workspace's retention period.
 */
export function retentionEndsAt(
  eventEndsAt: Date,
  retentionDays: number,
): Date {
  return new Date(eventEndsAt.getTime() + retentionDays * DAY_MS);
}

/**
 * When an attendee session ends: a day after the event ends, so an attendee
 * who verifies weeks ahead is still signed in on the day; and never sooner
 * than a day from now.
 */
export function attendeeSessionExpiresAt(eventEndsAt: Date, now: Date): Date {
  return new Date(Math.max(eventEndsAt.getTime(), now.getTime()) + DAY_MS);
}
