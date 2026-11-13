import { describe, expect, it } from "vitest";

import { moveAfter } from "./runbook-order.js";

const order = ["a", "b", "c", "d"];

describe("moveAfter", () => {
  it.each([
    ["to the front", "c", null, ["c", "a", "b", "d"]],
    ["down", "a", "c", ["b", "c", "a", "d"]],
    ["up", "d", "a", ["a", "d", "b", "c"]],
    ["to the end", "b", "d", ["a", "c", "d", "b"]],
    ["to where it already is", "b", "a", ["a", "b", "c", "d"]],
  ])("moves a task %s", (_label, taskId, afterId, expected) => {
    expect(moveAfter(order, taskId, afterId)).toEqual(expected);
  });

  it.each([
    ["an unknown task", "x", "a"],
    ["an unknown anchor", "a", "x"],
    ["a task after itself", "b", "b"],
  ])("refuses %s", (_label, taskId, afterId) => {
    expect(moveAfter(order, taskId, afterId)).toBeUndefined();
  });

  it("does not change its input", () => {
    const input = [...order];
    moveAfter(input, "a", "d");
    expect(input).toEqual(order);
  });
});
