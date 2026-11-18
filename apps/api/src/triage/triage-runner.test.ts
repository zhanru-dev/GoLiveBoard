import { describe, expect, it } from "vitest";

import {
  QUEUED_FOR_TOO_LONG_MS,
  RUNNING_FOR_TOO_LONG_MS,
  TRIAGE_TIMEOUT_MS,
} from "./triage-runner.js";

describe("the triage run's limits", () => {
  it("gives the model 8 seconds (FR-RN-6)", () => {
    expect(TRIAGE_TIMEOUT_MS).toBe(8_000);
  });

  it("closes a run left running for a minute, or queued for five", () => {
    expect(RUNNING_FOR_TOO_LONG_MS).toBe(60_000);
    expect(QUEUED_FOR_TOO_LONG_MS).toBe(300_000);
  });
});
