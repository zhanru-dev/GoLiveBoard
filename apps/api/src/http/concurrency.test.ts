import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain/domain-error.js";
import { etagFor, versionFromIfMatch } from "./concurrency.js";

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : "not a DomainError";
  }
}

describe("etagFor", () => {
  it("quotes the version as a strong entity tag", () => {
    expect(etagFor(7)).toBe('"7"');
  });
});

describe("versionFromIfMatch", () => {
  it("reads the version from the ETag the client loaded", () => {
    expect(versionFromIfMatch('"7"')).toBe(7);
    expect(versionFromIfMatch(' "12" ')).toBe(12);
  });

  it.each([undefined, "", "  ", "*"])(
    "requires a precondition when If-Match is %j",
    (header) => {
      expect(codeOf(() => versionFromIfMatch(header))).toBe(
        "PRECONDITION_REQUIRED",
      );
    },
  );

  it.each(['W/"7"', "7", '"7", "8"', '"0"', '"-1"', '"abc"', '"1234567890"'])(
    "treats %j as a precondition that cannot match",
    (header) => {
      expect(codeOf(() => versionFromIfMatch(header))).toBe("VERSION_CONFLICT");
    },
  );
});
