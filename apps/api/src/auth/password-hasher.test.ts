import { describe, expect, it } from "vitest";

import { PasswordHasher } from "./password-hasher.js";

describe("PasswordHasher", () => {
  const hasher = new PasswordHasher();

  it("stores Argon2id hashes with the OWASP parameters", async () => {
    await expect(hasher.hash("correct horse battery")).resolves.toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it("salts every hash, so equal passwords hash differently", async () => {
    const [first, second] = await Promise.all([
      hasher.hash("same password here"),
      hasher.hash("same password here"),
    ]);

    expect(first).not.toBe(second);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hasher.hash("correct horse battery");

    await expect(hasher.verify(stored, "correct horse battery")).resolves.toBe(
      true,
    );
    await expect(hasher.verify(stored, "Correct horse battery")).resolves.toBe(
      false,
    );
  });

  it("does the same work for unknown accounts and always fails", async () => {
    await expect(hasher.verifyAgainstDummy("anything")).resolves.toBe(false);
  });
});
