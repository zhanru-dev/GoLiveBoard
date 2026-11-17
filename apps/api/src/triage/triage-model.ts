import type { ModelTriage } from "./domain/prompt.js";
import type { Attempt, TokenUsage } from "./domain/pricing.js";

/** What a model answered, and what it took. */
export interface TriageAnswer {
  readonly output: ModelTriage;
  /** The model that actually answered (a fallback, possibly). */
  readonly model: string;
  /** All attempts' tokens together. */
  readonly usage: TokenUsage;
  /** Each model's attempt, a declined one too: what the request cost. */
  readonly attempts: readonly Attempt[];
}

/**
 * What a failed request was billed: the attempts the provider reported, or
 * UNKNOWN when it answered but its usage could not be read (the run then
 * counts its worst cost). None for a request the provider refused or never
 * received.
 */
export type FailedSpend = readonly Attempt[] | "UNKNOWN";

/** Why a model gave no usable answer, in words fit for a moderator. */
export class TriageModelError extends Error {
  constructor(
    readonly kind: "REFUSED" | "MALFORMED" | "UNAVAILABLE",
    message: string,
    readonly spent: FailedSpend = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TriageModelError";
  }
}

/**
 * A model that groups questions (ADR-0012). It is given the questions'
 * labels and text only. A new provider is a new implementation; the run,
 * its checks, timeout and records stay the same.
 *
 * @throws TriageModelError, or the signal's reason once it is aborted
 */
export abstract class TriageModel {
  abstract triage(
    questions: string,
    signal: AbortSignal,
    maxOutputTokens?: number,
  ): Promise<TriageAnswer>;
}

/** The configured model, or null when triage is off (AI_PROVIDER=none). */
export const TRIAGE_MODEL = Symbol("TRIAGE_MODEL");
