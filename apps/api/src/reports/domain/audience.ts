const MINUTE_MS = 60_000;

/** One minute of the audience chart. */
export interface AudiencePoint {
  readonly minute: Date;
  readonly viewers: number;
}

export interface AudienceSummary {
  /** Every minute from the start to the end, with how many watched. */
  readonly series: readonly AudiencePoint[];
  readonly peak: number;
  /** The mean over the series' minutes, to one decimal place. */
  readonly average: number;
}

/**
 * Concurrent audience (FR-RC-3) from attendance minutes (one row per
 * attendee and minute in which they sent a heartbeat). The series runs over
 * the scheduled window, widened to any minute someone watched outside it,
 * so a late start or an overrun is shown, and minutes nobody watched count
 * as 0 in the average.
 */
export function summariseAudience(
  minutes: readonly { readonly minute: Date; readonly viewers: number }[],
  startsAt: Date,
  endsAt: Date,
): AudienceSummary {
  const counts = new Map(
    minutes.map(({ minute, viewers }) => [floorToMinute(minute), viewers]),
  );
  const observed = [...counts.keys()];
  const first = Math.min(floorToMinute(startsAt), ...observed);
  const last = Math.max(
    // The minute the event ends in is not part of it.
    floorToMinute(new Date(endsAt.getTime() - 1)),
    ...observed,
  );
  const series: AudiencePoint[] = [];
  for (let at = first; at <= last; at += MINUTE_MS) {
    series.push({ minute: new Date(at), viewers: counts.get(at) ?? 0 });
  }
  const total = series.reduce((sum, { viewers }) => sum + viewers, 0);
  return {
    series,
    peak: Math.max(0, ...series.map(({ viewers }) => viewers)),
    average:
      series.length === 0 ? 0 : Math.round((total / series.length) * 10) / 10,
  };
}

function floorToMinute(date: Date): number {
  return date.getTime() - (date.getTime() % MINUTE_MS);
}
