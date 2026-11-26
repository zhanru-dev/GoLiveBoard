import type { Question } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import { actionsFor } from "./live-section";

const question = (changes: Partial<Question>): Question => ({
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  body: "Why?",
  status: "PUBLISHED",
  author: { kind: "ATTENDEE", name: "Ada" },
  pinSlot: null,
  voteCount: 0,

  mergedIntoId: null,

  version: 1,
  createdAt: "2026-11-15T12:00:00.000Z",
  ...changes,
});

describe("actionsFor (FR-RN-5)", () => {
  it("offers exactly the moves the API allows", () => {
    const labels = (changes: Partial<Question>) =>
      actionsFor(question(changes)).map(({ label }) => label);

    expect(labels({ status: "PENDING" })).toEqual(["Approve", "Hide"]);
    expect(labels({ status: "PUBLISHED" })).toEqual([
      "Mark answered",
      "Pin",
      "Hide",
    ]);
    expect(labels({ status: "PUBLISHED", pinSlot: 2 })).toEqual([
      "Mark answered",
      "Unpin",
      "Hide",
    ]);
    expect(labels({ status: "ANSWERED" })).toEqual(["Reopen", "Pin"]);
    expect(labels({ status: "HIDDEN" })).toEqual(["Publish"]);
  });

  it("offers nothing for a question merged into another", () => {
    expect(
      actionsFor(
        question({ mergedIntoId: "0195f0a0-0000-7000-8000-0000000000a2" }),
      ),
    ).toEqual([]);
  });
});
