import { z } from "zod";

import { EventStatus } from "./events.js";

const Instant = z.iso.datetime();

// ---------------------------------------------------------------- runbook

const TASK_TITLE_MAX_LENGTH = 200;

export const TaskStatus = z.enum(["TODO", "DONE"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

const Person = z.object({ userId: z.uuid(), name: z.string() });

/** One runbook task (FR-LC-1); its `version` is also its `ETag`. */
export const RunbookTask = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  title: z.string(),
  isCritical: z.boolean(),
  status: TaskStatus,
  /** 1-based place in the runbook. */
  position: z.int().min(1),
  owner: Person.nullable(),
  dueAt: Instant.nullable(),
  completedAt: Instant.nullable(),
  completedBy: Person.nullable(),
  version: z.int().min(1),
});
export type RunbookTask = z.infer<typeof RunbookTask>;

const TaskTitle = z
  .string()
  .trim()
  .min(1, { error: "Enter what needs doing" })
  .max(TASK_TITLE_MAX_LENGTH);

/** New tasks go to the end of the runbook. */
export const CreateRunbookTaskRequest = z.object({
  title: TaskTitle,
  isCritical: z.boolean().default(false),
  ownerUserId: z.uuid().nullable().default(null),
  dueAt: Instant.nullable().default(null),
});
export type CreateRunbookTaskRequest = z.infer<typeof CreateRunbookTaskRequest>;

/** `status: "DONE"` completes a task, `"TODO"` reopens it. */
export const UpdateRunbookTaskRequest = z
  .object({
    title: TaskTitle,
    isCritical: z.boolean(),
    ownerUserId: z.uuid().nullable(),
    dueAt: Instant.nullable(),
    status: TaskStatus,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: "Change at least one field",
  });
export type UpdateRunbookTaskRequest = z.infer<typeof UpdateRunbookTaskRequest>;

/** Places the task right after `after`, or first when `after` is null. */
export const MoveRunbookTaskRequest = z.object({ after: z.uuid().nullable() });
export type MoveRunbookTaskRequest = z.infer<typeof MoveRunbookTaskRequest>;

// ---------------------------------------------------------- access policy

export const AccessMode = z.enum(["PUBLIC", "EMAIL_DOMAIN", "INVITE_ONLY"]);
export type AccessMode = z.infer<typeof AccessMode>;

const MAX_ALLOWED_DOMAINS = 20;
/** A DNS name such as "example.co.uk": labels of letters, digits and hyphens. */
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const EmailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DOMAIN_PATTERN, { error: "Enter a domain such as example.com" });

export const AccessPolicy = z.object({
  mode: AccessMode,
  allowedDomains: z.array(z.string()),
  privacyNoticeVersion: z.string(),
  version: z.int().min(1),
  updatedAt: Instant,
});
export type AccessPolicy = z.infer<typeof AccessPolicy>;

/**
 * Domains are required for `EMAIL_DOMAIN` and refused for the other modes, so
 * a policy never carries a list that does nothing.
 */
export const PutAccessPolicyRequest = z
  .object({
    mode: AccessMode,
    allowedDomains: z
      .array(EmailDomain)
      .max(MAX_ALLOWED_DOMAINS)
      .default([])
      .transform((domains) => [...new Set(domains)]),
    privacyNoticeVersion: z.string().trim().min(1).max(50),
  })
  .refine(
    (policy) =>
      (policy.mode === "EMAIL_DOMAIN") === policy.allowedDomains.length > 0,
    {
      path: ["allowedDomains"],
      error: "List the allowed domains for EMAIL_DOMAIN, and only then.",
    },
  );
export type PutAccessPolicyRequest = z.infer<typeof PutAccessPolicyRequest>;

// -------------------------------------------------------------- readiness

/** The criteria of readiness rule version 1 (docs/03 section 3). */
export const ReadinessCriterion = z.enum([
  "ACCESS_POLICY",
  "STREAM_REACHABLE",
  "CRITICAL_TASKS_DONE",
  "HOLDING_SLATE",
  "ALL_TASKS_DONE",
  "OWNER_AND_DESCRIPTION",
]);
export type ReadinessCriterion = z.infer<typeof ReadinessCriterion>;

/** Where in Launch Control a criterion is fixed. */
export const ReadinessSection = z.enum([
  "ACCESS_POLICY",
  "STREAM",
  "RUNBOOK",
  "HOLDING_SLATE",
  "DETAILS",
]);
export type ReadinessSection = z.infer<typeof ReadinessSection>;

export const CriterionResult = z.object({
  criterion: ReadinessCriterion,
  score: z.int().min(0),
  maxScore: z.int().min(1),
  /** True when this criterion currently blocks READY and LIVE. */
  blocking: z.boolean(),
  /** What the score is based on, in words, e.g. "2 of 3 critical tasks done". */
  evidence: z.string(),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const Blocker = z.object({
  criterion: ReadinessCriterion,
  evidence: z.string(),
});
export type Blocker = z.infer<typeof Blocker>;

export const NextAction = z.object({
  criterion: ReadinessCriterion,
  action: z.string(),
  /** Points the score gains when this is done. */
  gain: z.int().min(1),
  /** Whether doing it removes a hard blocker. */
  unblocks: z.boolean(),
  section: ReadinessSection,
});
export type NextAction = z.infer<typeof NextAction>;

/** Body of `GET /events/:id/readiness` (FR-LC-2 to FR-LC-4). */
export const Readiness = z.object({
  ruleVersion: z.int().min(1),
  assessedAt: Instant,
  score: z.int().min(0).max(100),
  criteria: z.array(CriterionResult),
  blockers: z.array(Blocker),
  nextActions: z.array(NextAction),
});
export type Readiness = z.infer<typeof Readiness>;

// ------------------------------------------------------------ transitions

/** Body of `POST /events/:id/transitions`. */
export const TransitionRequest = z.object({ to: EventStatus });
export type TransitionRequest = z.infer<typeof TransitionRequest>;
