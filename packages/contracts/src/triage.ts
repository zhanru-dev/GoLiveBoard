import { z } from "zod";

/** One group of questions that ask the same thing (FR-RN-6). */
export const TriageGroup = z.object({
  /** The question to keep; the others are merged into it if accepted. */
  representativeId: z.uuid(),
  /** Every question of the group, the representative included. */
  questionIds: z.array(z.uuid()).min(2).max(200),
  /** Why they ask the same thing, in a sentence. */
  reason: z.string().max(500),
});
export type TriageGroup = z.infer<typeof TriageGroup>;

/**
 * A run's suggestions, already checked against the questions it was given:
 * every ID is one of them, and none is in two groups.
 */
export const TriageSuggestions = z.object({
  groups: z.array(TriageGroup).max(200),
  /** Which to answer first: questions not merged away, best first. */
  answerOrder: z.array(z.uuid()).max(200),
});
export type TriageSuggestions = z.infer<typeof TriageSuggestions>;

export const TriageRunStatus = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
]);
export type TriageRunStatus = z.infer<typeof TriageRunStatus>;

export const TriageDecision = z.enum([
  "PENDING",
  "ACCEPTED",
  "PARTIAL",
  "REJECTED",
]);
export type TriageDecision = z.infer<typeof TriageDecision>;

/** `GET /question-triage-runs/:id` (docs/04 section 3.6). */
export const TriageRun = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: TriageRunStatus,
  decision: TriageDecision,
  /** How many questions it was given. */
  questionCount: z.number().int().nonnegative(),
  suggestions: TriageSuggestions.nullable(),
  /** Why there are no suggestions, in words fit for a moderator. */
  failure: z.string().nullable(),
  model: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** In millionths of a US dollar. */
  costMicros: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type TriageRun = z.infer<typeof TriageRun>;

/** `POST /events/:id/question-triage-runs`: `202` with the run. */
export const TriageRunStarted = z.object({ id: z.uuid() });
export type TriageRunStarted = z.infer<typeof TriageRunStarted>;

/**
 * `POST /question-triage-runs/:id/decision`: the groups to merge, by their
 * index in `suggestions.groups`; none rejects every suggestion.
 */
export const TriageDecisionRequest = z.object({
  acceptedGroups: z
    .array(z.int().min(0).max(199))
    .max(200)
    .refine((groups) => new Set(groups).size === groups.length, {
      error: "Name each group once",
    }),
});
export type TriageDecisionRequest = z.infer<typeof TriageDecisionRequest>;
