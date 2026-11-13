import { describe, expect, it } from "vitest";

import { timeAgo } from "./relative-time.js";

const now = new Date("2026-12-01T18:00:00Z");
const before = (ms: number) => new Date(now.getTime() - ms);
const MINUTE = 60_000;

describe("timeAgo", () => {
  it.each([
    [0, "less than a minute ago"],
    [59_999, "less than a minute ago"],
    [MINUTE, "1 minute ago"],
    [2.9 * MINUTE, "2 minutes ago"],
    [60 * MINUTE, "1 hour ago"],
    [23.9 * 60 * MINUTE, "23 hours ago"],
    [48 * 60 * MINUTE, "2 days ago"],
    [-5 * MINUTE, "less than a minute ago"],
  ])("describes %s ms as %j", (ms, words) => {
    expect(timeAgo(before(ms), now)).toBe(words);
  });
});
