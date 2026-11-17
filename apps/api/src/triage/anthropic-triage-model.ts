import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import type { Attempt } from "./domain/pricing.js";
import { ModelTriage, TRIAGE_SYSTEM_PROMPT } from "./domain/prompt.js";
import {
  type TriageAnswer,
  TriageModel,
  TriageModelError,
} from "./triage-model.js";

/**
 * Claude through the Anthropic SDK, with structured output (the reply must
 * match `ModelTriage`), low effort (grouping is a classification task),
 * and the API's own fallback if the model declines. No retries: the run has
 * 8 seconds, and a moderator can start another.
 */
export class AnthropicTriageModel extends TriageModel {
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    apiKey: string,
    baseURL?: string,
  ) {
    super();
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0,
      ...(baseURL !== undefined && { baseURL }),
    });
  }

  async triage(
    questions: string,
    signal: AbortSignal,
    maxOutputTokens = 8_000,
  ): Promise<TriageAnswer> {
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: maxOutputTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: {
            format: betaZodOutputFormat(ModelTriage),
            effort: "low",
          },
          system: TRIAGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: questions }],
        },
        { signal },
      );
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new TriageModelError(
          "UNAVAILABLE",
          "The AI provider could not be reached",
          [],
          { cause: error },
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new TriageModelError(
          "UNAVAILABLE",
          `The AI provider answered ${String(error.status ?? "without a status")}`,
          [],
          { cause: error },
        );
      }
      // Otherwise the SDK could not read the answer as the schema: the
      // provider answered, and billed, but its usage is lost with it.
      throw new TriageModelError(
        "MALFORMED",
        "The AI model's answer was not in the expected form",
        "UNKNOWN",
        { cause: error },
      );
    }
    // Answered, so billed, whether usable or not.
    const attempts = attemptsOf(response, this.model);
    if (response.stop_reason === "refusal") {
      throw new TriageModelError(
        "REFUSED",
        "The AI model declined to sort these questions",
        attempts,
      );
    }
    if (
      response.stop_reason === "max_tokens" ||
      response.parsed_output === null
    ) {
      throw new TriageModelError(
        "MALFORMED",
        "The AI model's answer was incomplete",
        attempts,
      );
    }
    return {
      output: response.parsed_output,
      model: response.model,
      usage: {
        inputTokens: attempts.reduce(
          (sum, { inputTokens }) => sum + inputTokens,
          0,
        ),
        outputTokens: attempts.reduce(
          (sum, { outputTokens }) => sum + outputTokens,
          0,
        ),
      },
      attempts,
    };
  }
}

interface UsageCounts {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

/**
 * What each model's attempt used. With the API's fallback, `iterations`
 * lists the declined attempt and the fallback's; otherwise the top-level
 * usage is the one attempt. Cache tokens count as input (at full price:
 * an overestimate, never an underestimate).
 */
function attemptsOf(
  response: {
    readonly model: string;
    readonly usage: UsageCounts & {
      readonly iterations?:
        | readonly (UsageCounts & {
            readonly type: string;
            readonly model?: string | null;
          })[]
        | null;
    };
  },
  requested: string,
): Attempt[] {
  const input = (usage: UsageCounts) =>
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const iterations = (response.usage.iterations ?? []).filter(
    ({ type }) => type === "message" || type === "fallback_message",
  );
  if (iterations.length === 0) {
    return [
      {
        model: response.model,
        inputTokens: input(response.usage),
        outputTokens: response.usage.output_tokens,
      },
    ];
  }
  // An attempt that names no model was the one asked for, or, for the
  // fallback, the one that answered.
  return iterations.map((iteration) => ({
    model:
      iteration.model ??
      (iteration.type === "fallback_message" ? response.model : requested),
    inputTokens: input(iteration),
    outputTokens: iteration.output_tokens,
  }));
}
