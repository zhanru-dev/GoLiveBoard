import { describe, expect, it } from "vitest";

import { hasRole } from "./actor.js";

describe("hasRole", () => {
  it.each([
    ["OWNER", "MANAGER", true],
    ["OWNER", "OWNER", true],
    ["MANAGER", "ANALYST", true],
    ["MANAGER", "OWNER", false],
    ["ANALYST", "MANAGER", false],
  ] as const)("%s meets %s: %s", (actual, required, expected) => {
    expect(hasRole(actual, required)).toBe(expected);
  });
});
