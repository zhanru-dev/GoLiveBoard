const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * How long ago `then` was, in words for evidence: "less than a minute ago",
 * "1 minute ago", "3 hours ago", "2 days ago". Rounded down, so evidence never
 * makes a check look older than it is. A `then` after `now` counts as now.
 */
export function timeAgo(then: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / MS_PER_MINUTE),
  );
  if (minutes < 1) {
    return "less than a minute ago";
  }
  if (minutes < MINUTES_PER_HOUR) {
    return plural(minutes, "minute");
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return plural(hours, "hour");
  }
  return plural(Math.floor(hours / HOURS_PER_DAY), "day");
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"} ago`;
}
