import { z } from "zod";

import { EventStatus } from "./events.js";
import { Incident, IncidentKind } from "./streams.js";

/** `stream.status`: the latest stream check (docs/04 section 5). */
export const LiveOpsStreamStatus = z.object({
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  latencyMs: z.number().int().nonnegative(),
});
export type LiveOpsStreamStatus = z.infer<typeof LiveOpsStreamStatus>;

/**
 * `audience.updated`: attendees watching now (a heartbeat this minute or
 * the last), and the most in any one minute so far.
 */
export const LiveOpsAudience = z.object({
  current: z.number().int().nonnegative(),
  peak: z.number().int().nonnegative(),
});
export type LiveOpsAudience = z.infer<typeof LiveOpsAudience>;

/** `rates.updated`: what arrived in the last 60 seconds. */
export const LiveOpsRates = z.object({
  messagesPerMinute: z.number().int().nonnegative(),
  questionsPerMinute: z.number().int().nonnegative(),
});
export type LiveOpsRates = z.infer<typeof LiveOpsRates>;

/** A key moment of the event: a status change or an incident. */
export const LiveOpsMoment = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("STATUS_CHANGED"),
    at: z.iso.datetime(),
    from: EventStatus,
    to: EventStatus,
  }),
  z.object({
    kind: z.enum(["INCIDENT_OPENED", "INCIDENT_RESOLVED"]),
    at: z.iso.datetime(),
    incidentId: z.uuid(),
    incidentKind: IncidentKind,
  }),
]);
export type LiveOpsMoment = z.infer<typeof LiveOpsMoment>;

/**
 * `GET /events/:id/live-ops` and the stream's `snapshot` (FR-RN-7): the
 * whole operations room at once.
 */
export const LiveOps = z.object({
  event: z.object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    status: EventStatus,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
  stream: LiveOpsStreamStatus.nullable(),
  audience: LiveOpsAudience.extend({
    /** Viewers per minute since the event started (or since the first). */
    series: z.array(
      z.object({
        minute: z.iso.datetime(),
        viewers: z.number().int().nonnegative(),
      }),
    ),
  }),
  rates: LiveOpsRates,
  /** Open incidents, the most recently opened first. */
  incidents: z.array(Incident),
  /** Oldest first. */
  timeline: z.array(LiveOpsMoment),
  /** When these figures were read. */
  at: z.iso.datetime(),
});
export type LiveOps = z.infer<typeof LiveOps>;
