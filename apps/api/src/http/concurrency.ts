import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { DomainError } from "../shared/domain/domain-error.js";

/**
 * The `ETag` of an editable resource is its version (docs/04 section 2). It
 * is a strong tag: one version names exactly one state of the resource.
 */
export function etagFor(version: number): string {
  return `"${String(version)}"`;
}

/** One strong entity tag holding a positive version that fits a database int. */
const VERSION_TAG = /^"([1-9][0-9]{0,8})"$/;

/**
 * Reads the version a client based its change on from `If-Match`.
 *
 * - Missing, or `*` (which would match any version and so protect nothing):
 *   `428 PRECONDITION_REQUIRED`.
 * - Anything that is not one of our tags (a weak tag `W/"3"`, a list, garbage)
 *   can never equal the current `ETag`, so the precondition fails:
 *   `412 VERSION_CONFLICT`, as RFC 9110 prescribes for a false `If-Match`.
 */
export function versionFromIfMatch(header: string | undefined): number {
  const value = header?.trim();
  if (value === undefined || value === "" || value === "*") {
    throw new DomainError("PRECONDITION_REQUIRED", {
      detail: "Send the ETag of the version you loaded in If-Match.",
    });
  }
  const match = VERSION_TAG.exec(value);
  if (match?.[1] === undefined) {
    throw new DomainError("VERSION_CONFLICT");
  }
  return Number(match[1]);
}

/** Injects the version from the request's `If-Match` header. */
export const IfMatchVersion = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number =>
    versionFromIfMatch(
      context.switchToHttp().getRequest<Request>().get("if-match"),
    ),
);
