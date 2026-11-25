import { describe, expect, it } from "vitest";

import { generateToken, hashToken } from "./tokens.js";

describe("generateToken", () => {
  it("produces 32 random bytes as URL-safe text", () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });
});

describe("hashToken", () => {
  it("is deterministic, so a token can be found by its hash", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
