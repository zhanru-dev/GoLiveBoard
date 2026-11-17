import type { ModelTriage } from "./domain/prompt.js";
import type { TokenUsage } from "./domain/pricing.js";

/** What a model answered, and what it took. */
export interface TriageAnswer {
  readonly output: ModelTriage;
  /** The model that actually answered (a fallback, possibly). */
  readonly model: string;
  readonly usage: TokenUsage;
}

/** Why a model gave no usable answer, in words fit for a moderator. */
export class TriageModelError extends Error {
  constructor(
    readonly kind: "REFUSED" | "MALFORMED" | "UNAVAILABLE",
    message: string,
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
  ): Promise<TriageAnswer>;
}

/** The configured model, or null when triage is off (AI_PROVIDER=none). */
export const TRIAGE_MODEL = Symbol("TRIAGE_MODEL");
