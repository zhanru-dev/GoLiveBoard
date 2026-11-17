import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { ModelTriage, TRIAGE_SYSTEM_PROMPT } from "./domain/prompt.js";
import {
  type TriageAnswer,
  TriageModel,
  TriageModelError,
} from "./triage-model.js";

/** Room for 200 questions' groups and reasons. */
const MAX_OUTPUT_TOKENS = 8_000;

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

  async triage(questions: string, signal: AbortSignal): Promise<TriageAnswer> {
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
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
          { cause: error },
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new TriageModelError(
          "UNAVAILABLE",
          `The AI provider answered ${String(error.status ?? "without a status")}`,
          { cause: error },
        );
      }
      // Otherwise the SDK could not read the answer as the schema.
      throw new TriageModelError(
        "MALFORMED",
        "The AI model's answer was not in the expected form",
        { cause: error },
      );
    }
    if (response.stop_reason === "refusal") {
      throw new TriageModelError(
        "REFUSED",
        "The AI model declined to sort these questions",
      );
    }
    if (
      response.stop_reason === "max_tokens" ||
      response.parsed_output === null
    ) {
      throw new TriageModelError(
        "MALFORMED",
        "The AI model's answer was incomplete",
      );
    }
    return {
      output: response.parsed_output,
      model: response.model,
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (response.usage.cache_creation_input_tokens ?? 0) +
          (response.usage.cache_read_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
