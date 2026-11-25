import { describe, expect, it } from "vitest";

import { auditableUrl } from "./redact.js";

describe("auditableUrl (FR-RC-1)", () => {
  it("keeps where the URL points and drops what could be a secret", () => {
    expect(
      auditableUrl(
        "https://user:pass@cdn.example.com:8443/live/index.m3u8?token=abc#x",
      ),
    ).toBe("https://cdn.example.com:8443/live/index.m3u8?…");
    expect(auditableUrl("https://cdn.example.com/live.m3u8")).toBe(
      "https://cdn.example.com/live.m3u8",
    );
  });

  it("keeps null, and never repeats something that is not a URL", () => {
    expect(auditableUrl(null)).toBeNull();
    expect(auditableUrl("not a url with a token=abc")).toBe("(not a URL)");
  });
});
