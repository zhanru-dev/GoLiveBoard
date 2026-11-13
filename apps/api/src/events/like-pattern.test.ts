import { describe, expect, it } from "vitest";

import { escapeLikePattern } from "./like-pattern.js";

describe("escapeLikePattern", () => {
  it.each([
    ["100%", "100\\%"],
    ["snake_case", "snake\\_case"],
    ["back\\slash", "back\\\\slash"],
    ["plain", "plain"],
  ])("escapes %j as %j", (text, pattern) => {
    expect(escapeLikePattern(text)).toBe(pattern);
  });
});
