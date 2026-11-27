import { describe, expect, it } from "vitest";

import { checkVote, isPollEditable } from "./polls.js";

describe("isPollEditable (FR-RN-8)", () => {
  it("lets only a draft be edited, deleted or opened", () => {
    expect(isPollEditable("DRAFT")).toBe(true);
    expect(isPollEditable("OPEN")).toBe(false);
    expect(isPollEditable("CLOSED")).toBe(false);
  });
});

describe("checkVote (FR-RN-8)", () => {
  const options = ["a", "b"];

  it("counts a vote for one of an open poll's options", () => {
    expect(checkVote({ status: "OPEN", optionIds: options }, "b")).toEqual({
      ok: true,
    });
  });

  it("refuses a vote while the poll is not open, before looking at the option", () => {
    for (const status of ["DRAFT", "CLOSED"] as const) {
      expect(checkVote({ status, optionIds: options }, "z")).toEqual({
        ok: false,
        reason: "POLL_NOT_OPEN",
      });
    }
  });

  it("refuses an option of another poll", () => {
    expect(checkVote({ status: "OPEN", optionIds: options }, "z")).toEqual({
      ok: false,
      reason: "POLL_OPTION_INVALID",
    });
  });
});
