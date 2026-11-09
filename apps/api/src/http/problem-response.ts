import { HttpException } from "@nestjs/common";
import {
  ERROR_DEFINITIONS,
  type ErrorCode,
  type FieldError,
  type ProblemDetails,
  problemTypeFor,
} from "@opspilot/contracts";

import { DomainError } from "../shared/domain/domain-error.js";
import { RequestValidationError } from "./request-validation.js";

export interface ProblemResponse {
  readonly status: number;
  readonly body: ProblemDetails;
  /** True for bugs and outages: the error must be logged with its stack. */
  readonly unexpected: boolean;
}

/** Codes for errors raised by the framework and Express rather than by us. */
const CODE_BY_HTTP_STATUS: ReadonlyMap<number, ErrorCode> = new Map([
  [400, "VALIDATION_FAILED"],
  [401, "UNAUTHENTICATED"],
  [403, "FORBIDDEN"],
  [404, "NOT_FOUND"],
  [413, "PAYLOAD_TOO_LARGE"],
  [429, "RATE_LIMITED"],
  [503, "SERVICE_UNAVAILABLE"],
]);

/**
 * NestJS turns errors from Express middleware into `HttpException`s and keeps
 * the original as `cause`. The JSON body parser marks malformed bodies with
 * `type: "entity.parse.failed"`.
 */
function isMalformedJsonError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "type" in cause &&
    cause.type === "entity.parse.failed"
  );
}

interface ProblemOptions {
  readonly detail?: string | undefined;
  readonly errors?: readonly FieldError[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

function problem(
  code: ErrorCode,
  requestId: string,
  options: ProblemOptions = {},
): ProblemResponse {
  const { status, title } = ERROR_DEFINITIONS[code];
  const body: ProblemDetails = {
    // Extensions first, so they can never overwrite the standard members.
    ...options.extensions,
    type: problemTypeFor(code),
    title,
    status,
    code,
    requestId,
    ...(options.detail !== undefined && { detail: options.detail }),
    ...(options.errors !== undefined && { errors: [...options.errors] }),
  };
  return { status, body, unexpected: false };
}

function fromFrameworkError(
  status: number,
  requestId: string,
  detail?: string,
): ProblemResponse | undefined {
  const code = CODE_BY_HTTP_STATUS.get(status);
  return code === undefined ? undefined : problem(code, requestId, { detail });
}

/**
 * Maps anything thrown while handling a request to the problem response the
 * client receives. Unknown errors become a bare `500`: their message may
 * contain internal details, so it goes to the logs only.
 */
export function toProblemResponse(
  error: unknown,
  requestId: string,
): ProblemResponse {
  if (error instanceof RequestValidationError) {
    return problem("VALIDATION_FAILED", requestId, {
      errors: error.fieldErrors,
    });
  }
  if (error instanceof DomainError) {
    return problem(error.code, requestId, {
      detail: error.detail,
      extensions: error.extensions,
    });
  }
  if (error instanceof HttpException) {
    const detail = isMalformedJsonError(error.cause)
      ? "The request body is not valid JSON."
      : undefined;
    const mapped = fromFrameworkError(error.getStatus(), requestId, detail);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return { ...problem("INTERNAL_ERROR", requestId), unexpected: true };
}
