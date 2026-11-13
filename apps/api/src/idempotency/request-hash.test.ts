import { describe, expect, it } from "vitest";

import { hashRequestBody } from "./request-hash.js";

describe("hashRequestBody", () => {
  it("ignores key order at every depth", () => {
    expect(hashRequestBody({ a: 1, b: { c: [1, { d: 2, e: 3 }] } })).toBe(
      hashRequestBody({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 }),
    );
  });

  it("treats an undefined member as absent", () => {
    expect(hashRequestBody({ a: 1, b: undefined })).toBe(
      hashRequestBody({ a: 1 }),
    );
  });

  it.each([
    [{ a: 1 }, { a: 2 }],
    [{ a: null }, { a: "null" }],
    [{ a: [1, 2] }, { a: [2, 1] }],
  ])("tells %j and %j apart", (first, second) => {
    expect(hashRequestBody(first)).not.toBe(hashRequestBody(second));
  });
});
