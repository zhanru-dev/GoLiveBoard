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
  "CREDENTIALS_INVALID",
  "TOKEN_INVALID",
  "FORBIDDEN",
  "ORIGIN_FORBIDDEN",
  "DEMO_RESTRICTED",
  "OWNER_REQUIRED",
  "MEMBERSHIP_EXISTS",
  "WORKSPACE_CHANGED",
  "NOT_FOUND",
  "EVENT_ARCHIVED",
  "ILLEGAL_TRANSITION",
  "EVENT_HAS_BLOCKERS",
  "STREAM_NOT_SET",
  "UPLOAD_NOT_FOUND",
  "ASSET_REJECTED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "PRECONDITION_REQUIRED",
  "INTERACTION_CLOSED",
  "QUESTION_STATUS_INVALID",
  "QUESTION_NOT_PINNABLE",
  "PIN_LIMIT_REACHED",
  "QUESTION_NOT_VOTABLE",
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
  CREDENTIALS_INVALID: {
    status: 401,
    title: "The email address or password is incorrect",
  },
  TOKEN_INVALID: {
    status: 400,
    title: "The link is invalid, has expired or has already been used",
  },
  FORBIDDEN: {
    status: 403,
    title: "Your role does not allow this action",
  },
  ORIGIN_FORBIDDEN: {
    status: 403,
    title: "The request did not come from the OpsPilot web app",
  },
  DEMO_RESTRICTED: {
    status: 403,
    title: "This is not available in the demo",
  },
  OWNER_REQUIRED: {
    status: 409,
    title: "A workspace must always have at least one Owner",
  },
  MEMBERSHIP_EXISTS: {
    status: 409,
    title: "This person is already a member of the workspace",
  },
  WORKSPACE_CHANGED: {
    status: 409,
    title: "The session has switched to another workspace",
  },
  NOT_FOUND: { status: 404, title: "The resource was not found" },
  EVENT_ARCHIVED: {
    status: 409,
    title: "The event is archived and can no longer be changed",
  },
  ILLEGAL_TRANSITION: {
    status: 409,
    title: "The event cannot move to that status from its current one",
  },
  EVENT_HAS_BLOCKERS: {
    status: 409,
    title: "The event has unresolved hard blockers",
  },
  STREAM_NOT_SET: {
    status: 409,
    title: "The event has no stream URL to check",
  },
  UPLOAD_NOT_FOUND: {
    status: 409,
    title: "The file has not been uploaded yet",
  },
  ASSET_REJECTED: {
    status: 422,
    title: "The uploaded file is not an accepted image",
  },
  VERSION_CONFLICT: {
    status: 412,
    title: "The resource has changed since you loaded it",
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    title: "The idempotency key was already used for a different request",
  },
  PAYLOAD_TOO_LARGE: { status: 413, title: "The request body is too large" },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: "The request body's character set or encoding is not supported",
  },
  PRECONDITION_REQUIRED: {
    status: 428,
    title: "The If-Match header is required",
  },
  INTERACTION_CLOSED: {
    status: 409,
    title: "The event takes no questions or votes now",
  },
  QUESTION_STATUS_INVALID: {
    status: 409,
    title: "The question cannot move to that status from its current one",
  },
  QUESTION_NOT_PINNABLE: {
    status: 409,
    title: "Only published or answered questions can be pinned",
  },
  PIN_LIMIT_REACHED: {
    status: 409,
    title: "Three questions are pinned already; unpin one first",
  },
  QUESTION_NOT_VOTABLE: {
    status: 409,
    title: "Only published questions take votes",
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
