import { describe, expect, it } from "vitest";

import { ERROR_DEFINITIONS, ErrorCode, problemTypeFor } from "./errors.js";

describe("ERROR_DEFINITIONS", () => {
  it.each(ErrorCode.options)("gives %s an error status and a title", (code) => {
    const definition = ERROR_DEFINITIONS[code];

    expect(definition.status).toBeGreaterThanOrEqual(400);
    expect(definition.status).toBeLessThanOrEqual(599);
    expect(definition.title.length).toBeGreaterThan(0);
  });

  it("defines no codes beyond the ErrorCode enum", () => {
    expect(Object.keys(ERROR_DEFINITIONS).sort()).toEqual(
      [...ErrorCode.options].sort(),
    );
  });
});

describe("ErrorCode", () => {
  it("uses UPPER_SNAKE_CASE for every code", () => {
    for (const code of ErrorCode.options) {
      expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it("rejects an unknown code", () => {
    expect(ErrorCode.safeParse("TEAPOT").success).toBe(false);
  });
});

describe("problemTypeFor", () => {
  it("turns a code into a relative kebab-case URI", () => {
    expect(problemTypeFor("VERSION_CONFLICT")).toBe(
      "/problems/version-conflict",
    );
  });

  it("handles codes with several words", () => {
    expect(problemTypeFor("IDEMPOTENCY_KEY_REUSED")).toBe(
      "/problems/idempotency-key-reused",
    );
  });

  it("handles single-word codes", () => {
    expect(problemTypeFor("FORBIDDEN")).toBe("/problems/forbidden");
  });
});
