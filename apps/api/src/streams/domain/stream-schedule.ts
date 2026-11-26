import type { EventStatus } from "@goliveboard/contracts";

/** FR-ST-2: the manifest is fetched every 30 seconds… */
export const STREAM_CHECK_INTERVAL_MS = 30_000;
/** …from 60 minutes before the start until the end. */
export const STREAM_CHECK_LEAD_TIME_MS = 60 * 60_000;

/** Statuses in which an event may still go live or is live. */
const MONITORED: ReadonlySet<EventStatus> = new Set([
  "DRAFT",
  "CONFIGURING",
  "READY",
  "LIVE",
]);

export interface ScheduledEvent {
  readonly status: EventStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly streamUrl: string | null;
}

/**
 * Whether the scheduler should check an event's stream now (FR-ST-2): it has
 * a stream URL, it is not completed, cancelled or archived, the start is at
 * most 60 minutes away, and it has not ended. A `LIVE` event that runs past
 * its planned end is still checked, because attendees are still watching.
 */
export function isStreamCheckDue(event: ScheduledEvent, now: Date): boolean {
  if (event.streamUrl === null || !MONITORED.has(event.status)) {
    return false;
  }
  const windowOpens = event.startsAt.getTime() - STREAM_CHECK_LEAD_TIME_MS;
  if (now.getTime() < windowOpens) {
    return false;
  }
  return event.status === "LIVE" || now < event.endsAt;
}

/**
 * The 30-second slot `now` falls in. Scheduled checks are recorded per event
 * and slot, so a scheduler tick that runs twice checks once.
 */
export function slotFor(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / STREAM_CHECK_INTERVAL_MS) *
      STREAM_CHECK_INTERVAL_MS,
  );
}
