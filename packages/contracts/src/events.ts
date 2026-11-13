import { z } from "zod";

import { PageQuery, pageOf } from "./pagination.js";

/** docs/03-domain-and-data-model.md, section 2. */
export const EventStatus = z.enum([
  "DRAFT",
  "CONFIGURING",
  "READY",
  "LIVE",
  "COMPLETED",
  "ARCHIVED",
  "CANCELLED",
]);
export type EventStatus = z.infer<typeof EventStatus>;

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5_000;
const SEARCH_MAX_LENGTH = 100;
/** Ten times the capacity target (NFR-4) leaves room without allowing nonsense. */
export const EXPECTED_ATTENDANCE_MAX = 100_000;

/**
 * True for IANA time zone names the runtime knows, such as "Europe/London".
 * `Intl` exists in Node.js and every supported browser, so the check is the
 * same on both sides.
 */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { error: "Choose a valid time zone" });

/** An instant in UTC, written with `Z` (docs/04, section 2). */
const Instant = z.iso.datetime();

export const EventTitle = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
export const EventDescription = z.string().trim().max(DESCRIPTION_MAX_LENGTH);
export const ExpectedAttendance = z.int().min(1).max(EXPECTED_ATTENDANCE_MAX);

export const END_AFTER_START_MESSAGE = "End must be after start.";

/** The person responsible for an event; `null` when nobody is assigned. */
export const EventOwner = z.object({ userId: z.uuid(), name: z.string() });
export type EventOwner = z.infer<typeof EventOwner>;

/** One event in the list. */
export const EventSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  status: EventStatus,
  startsAt: Instant,
  endsAt: Instant,
  timeZone: z.string(),
  owner: EventOwner.nullable(),
});
export type EventSummary = z.infer<typeof EventSummary>;

/** Body of `GET /events/:id`; its `version` is also sent as the `ETag`. */
export const EventDetail = EventSummary.extend({
  description: z.string(),
  /** The HLS playback URL, set with `PUT /events/:id/stream`. */
  streamUrl: z.string().nullable(),
  expectedAttendance: z.int().nullable(),
  version: z.int().min(1),
  createdAt: Instant,
  updatedAt: Instant,
});
export type EventDetail = z.infer<typeof EventDetail>;

export const CreateEventRequest = z
  .object({
    title: EventTitle,
    description: EventDescription.default(""),
    startsAt: Instant,
    endsAt: Instant,
    timeZone: TimeZone,
    ownerUserId: z.uuid().nullable().default(null),
    expectedAttendance: ExpectedAttendance.nullable().default(null),
  })
  .refine((event) => Date.parse(event.endsAt) > Date.parse(event.startsAt), {
    path: ["endsAt"],
    error: END_AFTER_START_MESSAGE,
  });
export type CreateEventRequest = z.infer<typeof CreateEventRequest>;

/**
 * Any subset of the editable fields. Whether the end is still after the start
 * depends on the stored values too, so the API checks that after merging.
 */
export const UpdateEventRequest = z
  .object({
    title: EventTitle,
    description: EventDescription,
    startsAt: Instant,
    endsAt: Instant,
    timeZone: TimeZone,
    ownerUserId: z.uuid().nullable(),
    expectedAttendance: ExpectedAttendance.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: "Change at least one field",
  });
export type UpdateEventRequest = z.infer<typeof UpdateEventRequest>;

/** `?status=` may be repeated to match any of several statuses. */
const StatusFilter = z
  .union([EventStatus, z.array(EventStatus).min(1).max(7)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/**
 * FR-EV-3. `from` and `to` bound the start time: `from <= startsAt < to`.
 * Results are sorted by start time, latest first.
 */
export const ListEventsQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional(),
  status: StatusFilter.optional(),
  from: Instant.optional(),
  to: Instant.optional(),
}).refine(
  (query) =>
    query.from === undefined ||
    query.to === undefined ||
    Date.parse(query.to) > Date.parse(query.from),
  { path: ["to"], error: "The end of the range must be after its start." },
);
export type ListEventsQuery = z.infer<typeof ListEventsQuery>;

export const EventPage = pageOf(EventSummary);
export type EventPage = z.infer<typeof EventPage>;
