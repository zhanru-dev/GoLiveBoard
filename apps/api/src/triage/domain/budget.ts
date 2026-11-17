/** docs/06 section 10: what the shared demo may spend on AI each day. */
export const DEMO_TRIAGE_DAILY_RUNS = 30;
/** One US dollar, in millionths. */
export const DEMO_TRIAGE_DAILY_MICROS = 1_000_000;
/** Output tokens a run may use: room for its groups, never above 8,000. */
export function maxOutputTokens(questionCount: number): number {
  return Math.min(8_000, 1_000 + 40 * questionCount);
}

/**
 * The most a run can cost, reserved while it runs so runs at once cannot
 * all fit a budget: its text (about three characters a token) plus the
 * instructions, and its whole output allowance, at the dearest price.
 */
export function reserveMicros(
  textCharacters: number,
  questionCount: number,
  price: { readonly input: number; readonly output: number },
): number {
  const inputTokens = Math.ceil(textCharacters / 3) + 1_000;
  return Math.ceil(
    inputTokens * price.input + maxOutputTokens(questionCount) * price.output,
  );
}

/** The demo resets at 03:00 UK time; its AI day is the UK calendar day. */
export const DEMO_TIME_ZONE = "Europe/London";

/** A workspace's day so far: runs started, money spent and reserved. */
export interface Spent {
  readonly runs: number;
  readonly spentMicros: number;
  readonly reservedMicros: number;
}

export interface DailyLimit {
  /** Runs a day; none for real workspaces. */
  readonly runs?: number;
  readonly micros: number;
}

/** The demo's limit (docs/06 section 10). */
export const DEMO_LIMIT: DailyLimit = {
  runs: DEMO_TRIAGE_DAILY_RUNS,
  micros: DEMO_TRIAGE_DAILY_MICROS,
};

/**
 * Whether one more run, reserving `reserve`, fits the day: its run count
 * stays within the limit, and what was spent, what runs at the moment
 * reserve and its own reservation together stay within the money.
 */
export function mayRun(
  spent: Spent,
  reserve: number,
  limit: DailyLimit,
): boolean {
  return (
    (limit.runs === undefined || spent.runs < limit.runs) &&
    spent.spentMicros + spent.reservedMicros + reserve <= limit.micros
  );
}

/** `now`'s calendar date in `timeZone`, as YYYY-MM-DD. */
export function dateIn(now: Date, timeZone: string): string {
  const { year, month, day } = localParts(now, timeZone);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
