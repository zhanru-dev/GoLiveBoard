import { describe, expect, it } from "vitest";

import { APP_HOME, safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/settings/team?tab=invitations")).toBe(
      "/settings/team?tab=invitations",
    );
  });

  it.each([
    null,
    "https://evil.example",
    "//evil.example/path",
    "javascript:alert(1)",
  ])("falls back to the app home for %j", (next) => {
    expect(safeNext(next)).toBe(APP_HOME);
  });
});
