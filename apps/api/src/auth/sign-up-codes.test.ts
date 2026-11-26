import { describe, expect, it } from "vitest";

import {
  digestSignUpCode,
  matchSignUpCode,
  parseSignUpCodes,
} from "./sign-up-codes.js";

const hex = (code: string) => digestSignUpCode(code).toString("hex");

describe("parseSignUpCodes", () => {
  it("reads labelled digests separated by commas", () => {
    const digests = parseSignUpCodes(
      `acme:${hex("first-code")}, globex:${hex("second-code")}`,
    );

    expect(digests.map((digest) => digest.label)).toEqual(["acme", "globex"]);
    expect(digests[1]?.sha256).toEqual(digestSignUpCode("second-code"));
  });

  it.each([
    ["a code instead of a digest", "acme:first-code"],
    ["a digest without a label", hex("first-code")],
    ["an upper-case label", `Acme:${hex("first-code")}`],
    ["a short digest", `acme:${hex("first-code").slice(1)}`],
    ["an empty entry", `acme:${hex("first-code")},`],
  ])("refuses %s", (_, value) => {
    expect(() => parseSignUpCodes(value)).toThrow(/label:sha256/);
  });

  it("refuses a label used twice, so each code can be withdrawn on its own", () => {
    expect(() =>
      parseSignUpCodes(`acme:${hex("one")},acme:${hex("two")}`),
    ).toThrow('The label "acme" is used twice');
  });

  it("never repeats a long entry whole in its error", () => {
    const code = "a-real-code-pasted-by-mistake-instead-of-its-digest";

    expect(() => parseSignUpCodes(`acme:${code}`)).not.toThrow(code);
  });
});

describe("matchSignUpCode", () => {
  const digests = parseSignUpCodes(
    `acme:${hex("first-code")},globex:${hex("second-code")}`,
  );

  it("names the code that matches", () => {
    expect(matchSignUpCode(digests, "second-code")).toBe("globex");
  });

  it("ignores spaces around the code, as people paste them", () => {
    expect(matchSignUpCode(digests, "  first-code\n")).toBe("acme");
  });

  it.each(["", "first-cod", "First-code", "first-code-2"])(
    "matches nothing for %j",
    (code) => {
      expect(matchSignUpCode(digests, code)).toBeUndefined();
    },
  );

  it("matches nothing when there are no codes", () => {
    expect(matchSignUpCode([], "first-code")).toBeUndefined();
  });
});
