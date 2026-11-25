/**
 * Prices in US dollars per million tokens (Anthropic's list prices,
 * 2026-11), which are also millionths of a dollar per token. The default
 * model and the models the API's own fallback may answer with are listed.
 */
const PRICES: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  // Up to 100K tokens in a prompt; a triage run sends far fewer.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** A model not listed is charged as the dearest listed: never as free. */
export const HIGHEST_PRICE = {
  input: Math.max(...Object.values(PRICES).map(({ input }) => input)),
  output: Math.max(...Object.values(PRICES).map(({ output }) => output)),
};

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** One model's turn at a request: the asked model, or a fallback. */
export interface Attempt extends TokenUsage {
  readonly model: string;
}

/**
 * What the attempts cost, in millionths of a dollar, rounded once: a
 * declined attempt counts too, as the API bills it.
 */
export function costMicros(attempts: readonly Attempt[]): number {
  return Math.round(
    attempts.reduce((sum, attempt) => {
      const price = PRICES[attempt.model] ?? HIGHEST_PRICE;
      return (
        sum +
        attempt.inputTokens * price.input +
        attempt.outputTokens * price.output
      );
    }, 0),
  );
}
