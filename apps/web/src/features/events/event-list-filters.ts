import type { EventStatus } from "@goliveboard/contracts";

/** The list's search and filters (FR-EV-3). */
export interface EventListFilters {
  readonly q?: string;
  readonly status?: EventStatus;
  /** Events starting at or after this instant (UTC, ISO 8601). */
  readonly from?: string;
  /** Events starting before this instant (UTC, ISO 8601). */
  readonly to?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instants a day range covers, for `from` and `to`: from the start of
 * the first day to the start of the day after the last, in the browser's
 * time zone (the person filtering thinks in their own days). Either end may
 * be empty.
 *
 * @param fromDay - `YYYY-MM-DD` or ""
 * @param toDay - `YYYY-MM-DD` or "", included in the range
 */
export function dayRange(
  fromDay: string,
  toDay: string,
): { from?: string; to?: string } {
  const startOf = (day: string) => new Date(`${day}T00:00`);
  return {
    ...(fromDay === "" ? {} : { from: startOf(fromDay).toISOString() }),
    ...(toDay === ""
      ? {}
      : {
          // The start of the next day, so the last day is included; computed
          // from the calendar date, not by adding 24 hours, which would be
          // wrong on a day the clocks change.
          to: startOf(nextDay(toDay)).toISOString(),
        }),
  };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Date(date.getTime() + DAY_MS).toISOString().slice(0, 10);
}
