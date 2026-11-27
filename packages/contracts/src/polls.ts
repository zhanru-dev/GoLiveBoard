import { z } from "zod";

/** FR-RN-8 (docs/design/polls.md). */
export const PollStatus = z.enum(["DRAFT", "OPEN", "CLOSED"]);
export type PollStatus = z.infer<typeof PollStatus>;

export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;

export const PollQuestion = z.string().trim().min(1).max(200);
export const PollOptionLabel = z.string().trim().min(1).max(80);

/** 2 to 6 options, no two alike (ignoring case). */
const PollOptions = z
  .array(PollOptionLabel)
  .min(POLL_OPTIONS_MIN)
  .max(POLL_OPTIONS_MAX)
  .refine(
    (labels) =>
      new Set(labels.map((label) => label.toLowerCase())).size ===
      labels.length,
    { error: "Each option must be different" },
  );

/** `POST /events/:id/polls` (Managers): a draft. */
export const CreatePollRequest = z.object({
  question: PollQuestion,
  options: PollOptions,
});
export type CreatePollRequest = z.infer<typeof CreatePollRequest>;

/** `PATCH /polls/:id` (Managers, drafts only), with If-Match. */
export const UpdatePollRequest = z
  .object({ question: PollQuestion, options: PollOptions })
  .partial()
  .refine(
    (change) => change.question !== undefined || change.options !== undefined,
    { error: "Change the question, the options, or both" },
  );
export type UpdatePollRequest = z.infer<typeof UpdatePollRequest>;

/** `PUT /public/events/:slug/polls/:id/vote` (attendees): one, final. */
export const PollVoteRequest = z.object({ optionId: z.uuid() });
export type PollVoteRequest = z.infer<typeof PollVoteRequest>;

export const Poll = z.object({
  id: z.uuid(),
  question: z.string(),
  status: PollStatus,
  options: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      votes: z.int().min(0),
    }),
  ),
  totalVotes: z.int().min(0),
  /**
   * Only ever increases: a client keeps the newest snapshot it has, from a
   * response or a `poll.updated` message. Sent back in If-Match by staff.
   */
  version: z.int().min(1),
  openedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /**
   * The option the attendee chose, or null; set in attendees' lists and
   * vote answers, absent for staff and from `poll.updated` messages.
   */
  myOptionId: z.uuid().nullable().optional(),
});
export type Poll = z.infer<typeof Poll>;

/** `GET …/polls`: newest first. Attendees never see drafts. */
export const PollList = z.object({ items: z.array(Poll) });
export type PollList = z.infer<typeof PollList>;

/**
 * server → client `poll.updated`, to every connection on the event: the
 * whole poll as it is now. A client keeps the highest `version` it has seen
 * and reloads the list whenever it (re)joins; polls have no replay.
 */
export const PollUpdated = z.object({ poll: Poll });
export type PollUpdated = z.infer<typeof PollUpdated>;
