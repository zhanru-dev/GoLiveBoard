import type { z } from "zod";

import { DomainError } from "../shared/domain/domain-error.js";

/**
 * Cursors are opaque to clients (docs/04 section 2): base64url-encoded JSON
 * holding the sort key of the last item on a page. Clients cannot rely on the
 * format, so it can change without breaking them.
 */
export function encodeCursor(position: object): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

/**
 * Reads a cursor this API issued.
 *
 * @throws DomainError `VALIDATION_FAILED` on the `cursor` field when the value
 * was not produced by {@link encodeCursor} with this shape, so a tampered or
 * stale cursor is a client error, not a server error.
 */
export function decodeCursor<Position>(
  cursor: string,
  schema: z.ZodType<Position>,
): Position {
  const invalid = () =>
    new DomainError("VALIDATION_FAILED", {
      errors: [
        {
          path: "cursor",
          code: "invalid_cursor",
          message: "The cursor is not valid; start again from the first page.",
        },
      ],
    });
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw invalid();
  }
  return result.data;
}
