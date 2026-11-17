/** docs/06 section 10: what the shared demo may spend on AI each day. */
export const DEMO_TRIAGE_DAILY_RUNS = 30;
/** One US dollar, in millionths. */
export const DEMO_TRIAGE_DAILY_MICROS = 1_000_000;
/** The demo resets at 03:00 UK time; its AI day is the UK calendar day. */
export const DEMO_TIME_ZONE = "Europe/London";

export interface Spent {
  readonly runs: number;
  readonly costMicros: number;
}

/** Whether the demo may start another run today. */
export function demoMayRun(spent: Spent): boolean {
  return (
    spent.runs < DEMO_TRIAGE_DAILY_RUNS &&
    spent.costMicros < DEMO_TRIAGE_DAILY_MICROS
  );
}

/** Midnight that began `now`'s day in `timeZone`, as an instant. */
export function startOfDay(now: Date, timeZone: string): Date {
  const local = localParts(now, timeZone);
  const midnightAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  // The zone's offset at that midnight, found from a guess; twice, as the
  // guess may sit on the other side of a clock change.
  let instant = midnightAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = midnightAsUtc - offsetMs(new Date(instant), timeZone);
  }
  return new Date(instant);
}

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

/** How far the zone's clock is ahead of UTC at `instant`. */
function offsetMs(instant: Date, timeZone: string): number {
  const local = localParts(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
