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

/** The longest span the overview covers: three years. */
export const OVERVIEW_MAX_DAYS = 1096;

const DAY_MS = 86_400_000;

/**
 * `GET /reports/overview`: completed events that started from `from` to
 * `to`, both days included (UTC). Without them: the last twelve calendar
 * months, this one included.
 */
export const OverviewQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .partial()
  .refine(({ from, to }) => (from === undefined) === (to === undefined), {
    error: "Give both `from` and `to`, or neither",
    path: ["to"],
  })
  .refine(
    ({ from, to }) =>
      from === undefined ||
      to === undefined ||
      Date.parse(from) <= Date.parse(to),
    { error: "`from` must not be after `to`", path: ["from"] },
  )
  .refine(
    ({ from, to }) =>
      from === undefined ||
      to === undefined ||
      (Date.parse(to) - Date.parse(from)) / DAY_MS < OVERVIEW_MAX_DAYS,
    { error: "At most three years at a time", path: ["to"] },
  );
export type OverviewQuery = z.infer<typeof OverviewQuery>;

const Figures = {
  registered: Count,
  verified: Count,
  /** Watched for at least one minute. */
  attended: Count,
  questionsAsked: Count,
  questionsAnswered: Count,
  chatMessages: Count,
  incidents: Count,
};

/** One completed event in the overview, with its report's figures. */
export const OverviewEvent = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  ...Figures,
  peakAudience: Count,
});
export type OverviewEvent = z.infer<typeof OverviewEvent>;

/** The workspace's completed events over a span, with totals and months. */
export const WorkspaceOverview = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  totals: z.object({
    events: Count,
    ...Figures,
    /** The highest peak of any event. */
    peakAudience: Count,
    /** The mean of the events' peaks, to one decimal place. */
    averagePeak: z.number().nonnegative(),
  }),
  /** Every calendar month of the span, oldest first, empty ones too. */
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      events: Count,
      registered: Count,
      attended: Count,
      questionsAsked: Count,
    }),
  ),
  /** Most recent first. */
  events: z.array(OverviewEvent),
});
export type WorkspaceOverview = z.infer<typeof WorkspaceOverview>;
