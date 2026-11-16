import { z } from "zod";

import { EventStatus } from "./events.js";
import { Incident } from "./streams.js";

const Count = z.number().int().nonnegative();

/** `GET /events/:id/report` (FR-RC-3), once the event has completed. */
export const EventReport = z.object({
  event: z.object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    status: EventStatus,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timeZone: z.string(),
  }),
  /** When the audience figures were fixed: as the event completed. */
  generatedAt: z.iso.datetime(),
  funnel: z.object({
    registered: Count,
    /** Confirmed their address. */
    verified: Count,
    /** Watched for at least one minute. */
    attended: Count,
  }),
  audience: z.object({
    peak: Count,
    /** Mean viewers per minute over the series, to one decimal place. */
    average: z.number().nonnegative(),
    /**
     * Every minute of the scheduled window (widened to any minute someone
     * watched outside it): viewers, chat messages sent, and whether an
     * incident was open during it.
     */
    series: z.array(
      z.object({
        minute: z.iso.datetime(),
        viewers: Count,
        messages: Count,
        incident: z.boolean(),
      }),
    ),
  }),
  incidents: z.array(Incident),
  questions: z.object({ asked: Count, answered: Count }),
  /** Every message sent, removed ones too. */
  chat: z.object({ messages: Count }),
});
export type EventReport = z.infer<typeof EventReport>;
