import { describe, expect, it } from "vitest";

import { APP_HOME, safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/settings/team?tab=invitations#pending")).toBe(
      "/settings/team?tab=invitations#pending",
    );
  });

  it("resolves dot segments that stay on this site", () => {
    expect(safeNext("/settings/./team")).toBe("/settings/team");
    expect(safeNext("/a/../settings/team")).toBe("/settings/team");
  });

  it("keeps an encoded backslash, which browsers leave as part of the path", () => {
    expect(safeNext("/%5Cevil.example")).toBe("/%5Cevil.example");
  });

  it.each([
    null,
    "",
    "settings/team",
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r//evil.example",
    "/\u0000/evil.example",
    "/.//evil.example",
    "/%2e//evil.example",
    "/%2E//evil.example",
    "/a/..//evil.example",
    "/././/evil.example",
    "/x/%2e%2e//evil.example",
    "javascript:alert(1)",
  ])("falls back to the app home for %j", (next) => {
    expect(safeNext(next)).toBe(APP_HOME);
  });
});
