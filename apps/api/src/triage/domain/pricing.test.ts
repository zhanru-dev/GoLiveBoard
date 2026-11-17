import { describe, expect, it } from "vitest";

import { costMicros } from "./pricing.js";

describe("costMicros", () => {
  it("prices tokens at the model's list price, in millionths of a dollar", () => {
    // 10,000 in at $4/M = $0.04; 1,000 out at $20/M = $0.02.
    expect(
      costMicros("claude-opus-5-5", {
        inputTokens: 10_000,
        outputTokens: 1_000,
      }),
    ).toBe(60_000);
    expect(
      costMicros("claude-sonnet-5-5", {
        inputTokens: 10_000,
        outputTokens: 1_000,
      }),
    ).toBe(30_000);
    // $0.10/M and $0.50/M: fractions of a millionth per token, rounded once.
    expect(
      costMicros("claude-haiku-5-5", {
        inputTokens: 12_345,
        outputTokens: 678,
      }),
    ).toBe(1_574);
  });

  it("has no cost for a model it does not know", () => {
    expect(
      costMicros("someone-elses-model", { inputTokens: 1, outputTokens: 1 }),
    ).toBeNull();
  });
});
