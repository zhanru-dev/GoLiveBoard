import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "./password-hasher.js";

describe("password hashing", () => {
  it("stores Argon2id hashes with the OWASP parameters", async () => {
    await expect(hashPassword("correct horse battery")).resolves.toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it("salts every hash, so equal passwords hash differently", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same password here"),
      hashPassword("same password here"),
    ]);

    expect(first).not.toBe(second);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");

    await expect(verifyPassword(stored, "correct horse battery")).resolves.toBe(
      true,
    );
    await expect(verifyPassword(stored, "Correct horse battery")).resolves.toBe(
      false,
    );
  });

  it("does the same work for unknown accounts and always fails", async () => {
    await expect(verifyAgainstDummy("anything")).resolves.toBe(false);
  });
});
