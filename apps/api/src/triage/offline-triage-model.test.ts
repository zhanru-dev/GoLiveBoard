import { describe, expect, it } from "vitest";

import { OfflineTriageModel } from "./offline-triage-model.js";

describe("OfflineTriageModel", () => {
  it("groups questions with the same words, case and punctuation aside", async () => {
    const answer = await new OfflineTriageModel().triage(
      "<questions>\nq1: Is there a free tier?\nq2: Pricing for teams?\nq3: is there a FREE tier\n</questions>",
    );

    expect(answer).toEqual({
      output: {
        groups: [
          {
            representative: "q1",
            questions: ["q1", "q3"],
            reason: "The same words",
          },
        ],
        answer_order: ["q1", "q2"],
      },
      model: "offline",
      usage: { inputTokens: 0, outputTokens: 0 },
      attempts: [],
    });
  });
});
