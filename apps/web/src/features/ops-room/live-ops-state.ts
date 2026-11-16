import {
  Incident,
  LiveOps,
  LiveOpsAudience,
  LiveOpsRates,
  LiveOpsStreamStatus,
} from "@opspilot/contracts";

const MINUTE_MS = 60_000;

/** A message of the operations-room stream (docs/04 section 5). */
export interface StreamMessage {
  readonly event: string;
  readonly data: unknown;
}

/**
 * The room after one message. A snapshot replaces everything; the other
 * messages change their part. An unknown or malformed message changes
 * nothing (a newer API may send more).
 */
export function applyMessage(
  room: LiveOps | undefined,
  message: StreamMessage,
): LiveOps | undefined {
  if (message.event === "snapshot") {
    return LiveOps.safeParse(message.data).data ?? room;
  }
  if (room === undefined) {
    return room;
  }
  switch (message.event) {
    case "stream.status": {
      const stream = LiveOpsStreamStatus.safeParse(message.data);
      return stream.success ? { ...room, stream: stream.data } : room;
    }
    case "audience.updated": {
      const audience = LiveOpsAudience.safeParse(message.data);
      return audience.success ? withAudience(room, audience.data) : room;
    }
    case "rates.updated": {
      const rates = LiveOpsRates.safeParse(message.data);
      return rates.success ? { ...room, rates: rates.data } : room;
    }
    case "incident.opened": {
      const incident = Incident.safeParse(message.data);
      if (
        !incident.success ||
        room.incidents.some(({ id }) => id === incident.data.id)
      ) {
        return room;
      }
      return {
        ...room,
        incidents: [incident.data, ...room.incidents],
        timeline: [
          ...room.timeline,
          {
            kind: "INCIDENT_OPENED",
            at: incident.data.openedAt,
            incidentId: incident.data.id,
            incidentKind: incident.data.kind,
          },
        ],
      };
    }
    case "incident.resolved": {
      const incident = Incident.safeParse(message.data);
      if (!incident.success || incident.data.resolvedAt === null) {
        return room;
      }
      return {
        ...room,
        incidents: room.incidents.filter(({ id }) => id !== incident.data.id),
        timeline: [
          ...room.timeline,
          {
            kind: "INCIDENT_RESOLVED",
            at: incident.data.resolvedAt,
            incidentId: incident.data.id,
            incidentKind: incident.data.kind,
          },
        ],
      };
    }
    default:
      return room;
  }
}

/**
 * The new figures, and the chart's latest minute: the audience now stands
 * for the minute it was read in.
 */
function withAudience(room: LiveOps, audience: LiveOpsAudience): LiveOps {
  const now = Date.now();
  const minute = new Date(now - (now % MINUTE_MS)).toISOString();
  const series = room.audience.series.filter(
    (point) => point.minute !== minute,
  );
  return {
    ...room,
    audience: {
      ...audience,
      series: [...series, { minute, viewers: audience.current }],
    },
  };
}
