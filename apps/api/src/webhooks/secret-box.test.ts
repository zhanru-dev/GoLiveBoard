import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { keyIdOf, SecretBox } from "./secret-box.js";

const key = () => randomBytes(32);

describe("SecretBox (docs/02, section 7.8)", () => {
  it("seals with the current key and opens what it sealed", () => {
    const current = key();
    const box = new SecretBox(current);

    const sealed = box.seal("whsec_example");

    expect(sealed.keyId).toBe(keyIdOf(current));
    expect(sealed.ciphertext.toString("utf8")).not.toContain("whsec_example");
    expect(box.open(sealed)).toBe("whsec_example");
  });

  it("uses a fresh IV each time", () => {
    const box = new SecretBox(key());

    expect(
      box.seal("same").ciphertext.equals(box.seal("same").ciphertext),
    ).toBe(false);
  });

  it("opens secrets sealed with the previous key after a rotation", () => {
    const old = key();
    const sealed = new SecretBox(old).seal("before rotation");

    const rotated = new SecretBox(key(), old);

    expect(rotated.open(sealed)).toBe("before rotation");
    expect(rotated.seal("after").keyId).not.toBe(keyIdOf(old));
    expect(() => new SecretBox(key()).open(sealed)).toThrow(/not configured/);
  });

  it("refuses altered ciphertext", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("secret");
    const altered = Buffer.from(sealed.ciphertext);
    altered[altered.length - 1] = (altered.at(-1) ?? 0) ^ 1;

    expect(() => box.open({ ...sealed, ciphertext: altered })).toThrow();
  });

  it("refuses keys that are not 32 bytes", () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow(/32 bytes/);
  });
});
