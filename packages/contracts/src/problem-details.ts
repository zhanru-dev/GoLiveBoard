import { z } from "zod";

import { ErrorCode } from "./errors.js";

/** One invalid field in a request that failed validation. */
export const FieldError = z.object({
  /** Dot-separated path to the field, for example `schedule.endsAt`. */
  path: z.string(),
  /** Machine-readable reason, for example `too_small`. */
  code: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

/**
 * The body of every error response (`application/problem+json`, RFC 9457).
 *
 * The object is "loose" because RFC 9457 allows extension members: an error
 * can carry extra fields, such as `blockers` when an event cannot go live.
 */
export const ProblemDetails = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  code: ErrorCode,
  detail: z.string().optional(),
  /** Correlates the response with server logs; safe to show to users. */
  requestId: z.string(),
  errors: z.array(FieldError).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";
