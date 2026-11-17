/**
 * Prices in US dollars per million tokens (Anthropic's list prices,
 * 2026-11), which are also millionths of a dollar per token. A model not
 * listed has no recorded cost.
 */
const PRICES: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // Up to 100K tokens in a prompt; a triage run sends at most 200
  // questions of 1,000 characters, well under it.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** @returns millionths of a dollar, rounded, or null for an unknown model */
export function costMicros(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (price === undefined) {
    return null;
  }
  return Math.round(
    usage.inputTokens * price.input + usage.outputTokens * price.output,
  );
}
