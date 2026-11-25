import type { Incident } from "@opspilot/contracts";

/** What the stream last told the browser. */
export interface Told {
  readonly status: string;
  /** The latest stream check sent, by when it was made. */
  readonly checkedAt: string | null;
  /** Incident ID → whether it was sent as resolved. */
  readonly incidents: ReadonlyMap<string, boolean>;
}

export interface Now {
  readonly status: string;
  readonly checkedAt: string | null;
  /** Every incident of the event. */
  readonly incidents: readonly Incident[];
}

export type Change =
  | { readonly kind: "SNAPSHOT" }
  | { readonly kind: "STREAM_STATUS" }
  | { readonly kind: "INCIDENT_OPENED"; readonly incident: Incident }
  | { readonly kind: "INCIDENT_RESOLVED"; readonly incident: Incident };

/**
 * What to send, from what the browser was told and what is true now
 * (docs/04 section 5). A status change sends a whole snapshot, which
 * carries the new status and the timeline. An incident opened and resolved
 * between two looks is sent as both, in that order.
 */
export function changesBetween(told: Told, now: Now): Change[] {
  if (now.status !== told.status) {
    return [{ kind: "SNAPSHOT" }];
  }
  const changes: Change[] = [];
  if (now.checkedAt !== null && now.checkedAt !== told.checkedAt) {
    changes.push({ kind: "STREAM_STATUS" });
  }
  const oldestFirst = [...now.incidents].sort((a, b) =>
    a.openedAt.localeCompare(b.openedAt),
  );
  for (const incident of oldestFirst) {
    const sentResolved = told.incidents.get(incident.id);
    if (sentResolved === undefined) {
      changes.push({ kind: "INCIDENT_OPENED", incident });
    }
    if (incident.resolvedAt !== null && sentResolved !== true) {
      changes.push({ kind: "INCIDENT_RESOLVED", incident });
    }
  }
  return changes;
}

/** What the browser has been told once `changes` are sent. */
export function toldAfter(now: Now): Told {
  return {
    status: now.status,
    checkedAt: now.checkedAt,
    incidents: new Map(
      now.incidents.map(({ id, resolvedAt }) => [id, resolvedAt !== null]),
    ),
  };
}
