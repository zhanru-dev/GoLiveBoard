import { StandardSchemaValidationPipe } from "@nestjs/common";
import type { FieldError } from "@goliveboard/contracts";

/** One problem reported by a Standard Schema library such as Zod. */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

/** A request body, query or route parameter did not match its schema. */
export class RequestValidationError extends Error {
  override readonly name = "RequestValidationError";

  constructor(readonly fieldErrors: readonly FieldError[]) {
    super("Request validation failed");
  }
}

/**
 * Turns a schema issue into the `errors[]` entry clients receive:
 * `{ path: "schedule.endsAt", code: "too_small", message: "…" }`.
 */
export function toFieldError(issue: SchemaIssue): FieldError {
  const path = (issue.path ?? [])
    .map((segment) => (typeof segment === "object" ? segment.key : segment))
    .map(String)
    .join(".");
  // Zod adds a machine-readable code to each issue; other libraries may not.
  const code =
    "code" in issue && typeof issue.code === "string" ? issue.code : "invalid";
  return { path, code, message: issue.message };
}

/**
 * Validates every `@Body({ schema })`, `@Query({ schema })` and
 * `@Param({ schema })` against its schema. Parameters without a schema pass
 * through unchanged.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues: readonly SchemaIssue[]) =>
      new RequestValidationError(issues.map(toFieldError)),
  });
}
