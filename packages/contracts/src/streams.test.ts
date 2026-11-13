import { describe, expect, it } from "vitest";

import { SetStreamRequest } from "./streams.js";

describe("SetStreamRequest", () => {
  it("accepts an https playback URL", () => {
    const url = "https://stream.mux.com/abc123.m3u8?token=x";
    expect(SetStreamRequest.parse({ url })).toEqual({ url });
  });

  it.each([
    ["http", "http://stream.example.com/index.m3u8"],
    ["credentials", "https://user:secret@stream.example.com/index.m3u8"],
    ["not a URL", "stream.example.com/index.m3u8"],
    ["another scheme", "ftp://stream.example.com/index.m3u8"],
    ["too long", `https://example.com/${"a".repeat(2_100)}`],
  ])("rejects %s", (_label, url) => {
    expect(SetStreamRequest.safeParse({ url }).success).toBe(false);
  });
});
