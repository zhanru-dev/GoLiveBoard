import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DomainError } from "../shared/domain/domain-error.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

const Position = z.object({ startsAt: z.iso.datetime(), id: z.uuid() });
const position = {
  startsAt: "2026-12-01T18:00:00.000Z",
  id: "0193f2a4-7c1e-7b2a-9d1f-3e5c7a9b1d2f",
};

describe("cursors", () => {
  it("round-trips a position", () => {
    expect(decodeCursor(encodeCursor(position), Position)).toEqual(position);
  });

  it("uses only URL-safe characters", () => {
    expect(encodeCursor(position)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64 JSON", "%%%"],
    ["JSON of the wrong shape", encodeCursor({ startsAt: "yesterday" })],
  ])("rejects %s as a validation error on the cursor", (_label, cursor) => {
    let thrown: unknown;
    try {
      decodeCursor(cursor, Position);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [expect.objectContaining({ path: "cursor" })],
    });
  });
});
