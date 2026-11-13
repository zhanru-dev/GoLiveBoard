/**
 * Event times are stored in UTC and shown in the event's own time zone
 * (FR-EV-1), whatever the browser's zone is. The browser has no API to turn
 * a wall-clock time in another zone into UTC, so these helpers derive it from
 * the zone's offset, which Intl does know.
 */

const MS_PER_MINUTE = 60_000;

/** "GMT+05:30" → 330; "GMT" → 0. */
function parseOffset(label: string): number {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
  if (match === null) {
    return 0;
  }
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -total : total;
}

/** The zone's offset from UTC at an instant, in minutes. */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  return parseOffset(label ?? "GMT");
}

/**
 * Converts a wall-clock time in a zone to an ISO instant in UTC:
 * ("2026-07-01T18:00", "Europe/London") → "2026-07-01T17:00:00.000Z".
 *
 * The offset depends on the instant, which is what we are computing, so it
 * is applied twice: once from a first guess, then again from the corrected
 * instant, which settles it around daylight-saving changes. A time that does
 * not exist (skipped by the clocks going forward) lands just after the gap.
 *
 * @param local - `YYYY-MM-DDTHH:mm`, as a `datetime-local` input gives it
 */
export function zonedToUtc(local: string, timeZone: string): string {
  const [date = "", time = "00:00"] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
  );
  const firstGuess =
    wallClock - offsetMinutes(new Date(wallClock), timeZone) * MS_PER_MINUTE;
  const settled =
    wallClock - offsetMinutes(new Date(firstGuess), timeZone) * MS_PER_MINUTE;
  return new Date(settled).toISOString();
}

/**
 * The reverse, for filling a `datetime-local` input:
 * ("2026-07-01T17:00:00.000Z", "Europe/London") → "2026-07-01T18:00".
 */
export function utcToZoned(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const shifted = new Date(
    instant.getTime() + offsetMinutes(instant, timeZone) * MS_PER_MINUTE,
  );
  return shifted.toISOString().slice(0, 16);
}

/** "Tue, 1 Dec 2026, 18:00 GMT", in the event's zone. */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Every zone the browser knows, for the time-zone picker. */
export function timeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}
