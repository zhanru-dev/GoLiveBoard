import type { ModelTriage } from "./domain/prompt.js";
import { type TriageAnswer, TriageModel } from "./triage-model.js";

/**
 * No model: groups questions whose words are the same once case and
 * punctuation are set aside. For development and browser tests, where no
 * API key should be needed (AI_PROVIDER=offline); never a substitute for
 * the real thing.
 */
export class OfflineTriageModel extends TriageModel {
  triage(questions: string): Promise<TriageAnswer> {
    const byWords = new Map<string, string[]>();
    for (const line of questions.split("\n")) {
      const match = /^(q\d+): (.*)$/.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) {
        continue;
      }
      const words = match[2]
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      byWords.set(words, [...(byWords.get(words) ?? []), match[1]]);
    }
    const output: ModelTriage = { groups: [], answer_order: [] };
    for (const labels of byWords.values()) {
      const [first] = labels;
      if (first === undefined) {
        continue;
      }
      if (labels.length > 1) {
        output.groups.push({
          representative: first,
          questions: labels,
          reason: "The same words",
        });
      }
      output.answer_order.push(first);
    }
    return Promise.resolve({
      output,
      model: "offline",
      usage: { inputTokens: 0, outputTokens: 0 },
      attempts: [],
    });
  }
}
