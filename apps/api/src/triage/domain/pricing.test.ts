import { describe, expect, it } from "vitest";

import { costMicros, HIGHEST_PRICE } from "./pricing.js";

describe("costMicros", () => {
  it("prices tokens at the model's list price, in millionths of a dollar", () => {
    // 10,000 in at $4/M = $0.04; 1,000 out at $20/M = $0.02.
    expect(
      costMicros([
        { model: "claude-opus-5-5", inputTokens: 10_000, outputTokens: 1_000 },
      ]),
    ).toBe(60_000);
    expect(
      costMicros([
        {
          model: "claude-sonnet-5-5",
          inputTokens: 10_000,
          outputTokens: 1_000,
        },
      ]),
    ).toBe(30_000);
    // $0.10/M and $0.50/M: fractions of a millionth per token, rounded once.
    expect(
      costMicros([
        { model: "claude-haiku-5-5", inputTokens: 12_345, outputTokens: 678 },
      ]),
    ).toBe(1_574);
  });

  it("prices the models the API's fallback may answer with", () => {
    for (const model of ["claude-opus-5", "claude-opus-4-8"]) {
      expect(
        costMicros([{ model, inputTokens: 1_000, outputTokens: 100 }]),
      ).toBe(7_500);
    }
  });

  it("adds every attempt: a declined one and its fallback", () => {
    expect(
      costMicros([
        { model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 50 },
        { model: "claude-opus-4-8", inputTokens: 1_000, outputTokens: 100 },
      ]),
    ).toBe(5_000 + 7_500);
  });

  it("charges a model it does not know as the dearest it knows", () => {
    expect(
      costMicros([
        { model: "someone-elses-model", inputTokens: 1_000, outputTokens: 100 },
      ]),
    ).toBe(1_000 * HIGHEST_PRICE.input + 100 * HIGHEST_PRICE.output);
    expect(HIGHEST_PRICE).toEqual({ input: 5, output: 25 });
  });
});
