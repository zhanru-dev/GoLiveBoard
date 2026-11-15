import { describe, expect, it } from "vitest";

import { REPLAY_LIMIT, replayPlan } from "./replay.js";

describe("replayPlan", () => {
  it.each([
    [57, 57, "UP_TO_DATE"],
    [0, 0, "UP_TO_DATE"],
    [41, 57, "REPLAY"],
    [0, REPLAY_LIMIT, "REPLAY"],
    [0, REPLAY_LIMIT + 1, "RESYNC"],
    [58, 57, "RESYNC"],
  ])("after %i with the latest at %i: %s", (after, latest, kind) => {
    expect(replayPlan(after, latest).kind).toBe(kind);
  });
});
