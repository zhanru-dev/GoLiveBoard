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

/** Around a clock change the offset differs this far before and after. */
const HALF_DAY_MS = 12 * 60 * MS_PER_MINUTE;

/**
 * What a wall-clock time in a zone means:
 *
 * - `exact`: one instant, the usual case;
 * - `ambiguous`: the clocks went back, so it happened twice (01:30 on the
 *   first Sunday of November in New York is 05:30Z and then 06:30Z);
 * - `missing`: the clocks went forward over it (02:30 on the second Sunday
 *   of March in New York never happens).
 */
export type ZonedTime =
  | { readonly kind: "exact"; readonly utc: string }
  | {
      readonly kind: "ambiguous";
      readonly earlier: string;
      readonly later: string;
    }
  | { readonly kind: "missing" };

/** "YYYY-MM-DDTHH:mm" read as if it were UTC, in milliseconds. */
function wallClockMs(local: string): number {
  const [date = "", time = "00:00"] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
  );
}

/**
 * Finds every instant that shows `local` on the zone's clocks. Only two
 * offsets can apply on one day, the ones half a day before and after, so
 * each is tried and kept if it really maps back to the same wall clock.
 *
 * @param local - `YYYY-MM-DDTHH:mm`, as a `datetime-local` input gives it
 */
export function resolveZonedTime(local: string, timeZone: string): ZonedTime {
  const wallClock = wallClockMs(local);
  const offsets = new Set([
    offsetMinutes(new Date(wallClock - HALF_DAY_MS), timeZone),
    offsetMinutes(new Date(wallClock + HALF_DAY_MS), timeZone),
  ]);
  const instants = [...offsets]
    .map((offset) => new Date(wallClock - offset * MS_PER_MINUTE).toISOString())
    .filter((utc) => utcToZoned(utc, timeZone) === local.slice(0, 16))
    .sort();
  const [earlier, later] = instants;
  if (earlier === undefined) {
    return { kind: "missing" };
  }
  if (later === undefined || later === earlier) {
    return { kind: "exact", utc: earlier };
  }
  return { kind: "ambiguous", earlier, later };
}

/** "UTC−05:00" for an instant in a zone, to tell repeated times apart. */
export function offsetLabel(utc: string, timeZone: string): string {
  const minutes = offsetMinutes(new Date(utc), timeZone);
  const sign = minutes < 0 ? "−" : "+";
  const absolute = Math.abs(minutes);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
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
