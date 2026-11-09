import { z } from "zod";

/**
 * Every error the API can return has one stable code. Clients switch on the
 * code, never on `title` or `detail`, which are written for people and may change.
 *
 * Feature-specific codes (for example `EVENT_HAS_BLOCKERS`) are added here by
 * the milestone that introduces them.
 */
export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "PRECONDITION_REQUIRED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export interface ErrorDefinition {
  /** HTTP status sent with this error. */
  readonly status: number;
  /** Short, human-readable summary that is the same for every occurrence. */
  readonly title: string;
}

/**
 * The single source of truth for how each code is presented over HTTP.
 * `satisfies` makes the compiler reject a code that has no definition.
 */
export const ERROR_DEFINITIONS = {
  VALIDATION_FAILED: { status: 400, title: "The request is not valid" },
  UNAUTHENTICATED: { status: 401, title: "You need to sign in" },
  FORBIDDEN: {
    status: 403,
    title: "Your role does not allow this action",
  },
  NOT_FOUND: { status: 404, title: "The resource was not found" },
  VERSION_CONFLICT: {
    status: 412,
    title: "The resource has changed since you loaded it",
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    title: "The idempotency key was already used for a different request",
  },
  PRECONDITION_REQUIRED: {
    status: 428,
    title: "The If-Match header is required",
  },
  RATE_LIMITED: { status: 429, title: "Too many requests" },
  INTERNAL_ERROR: { status: 500, title: "Something went wrong on our side" },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: "The service is temporarily unavailable",
  },
} as const satisfies Record<ErrorCode, ErrorDefinition>;

/**
 * The problem `type` for a code, as a relative URI reference:
 * `VERSION_CONFLICT` → `/problems/version-conflict`.
 */
export function problemTypeFor(code: ErrorCode): string {
  return `/problems/${code.toLowerCase().replaceAll("_", "-")}`;
}
