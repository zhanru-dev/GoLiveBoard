/** FR-ST-2: two consecutive failures open an incident, two successes resolve it. */
export const CONSECUTIVE_CHECKS = 2;

export type IncidentChange = "OPEN" | "RESOLVE" | "NONE";

/**
 * Decides what the latest stream checks mean for the event's incident.
 *
 * @param recent - the latest checks of the current URL, newest first
 * @param hasOpenIncident - whether a STREAM_UNREACHABLE incident is open
 * @returns `OPEN` after two failures in a row with no incident open,
 * `RESOLVE` after two successes in a row with one open, otherwise `NONE`
 * (one result on its own changes nothing, so a single blip does not page
 * anyone)
 */
export function incidentChange(
  recent: readonly { readonly ok: boolean }[],
  hasOpenIncident: boolean,
): IncidentChange {
  const latest = recent.slice(0, CONSECUTIVE_CHECKS);
  if (latest.length < CONSECUTIVE_CHECKS) {
    return "NONE";
  }
  if (!hasOpenIncident && latest.every((check) => !check.ok)) {
    return "OPEN";
  }
  if (hasOpenIncident && latest.every((check) => check.ok)) {
    return "RESOLVE";
  }
  return "NONE";
}
