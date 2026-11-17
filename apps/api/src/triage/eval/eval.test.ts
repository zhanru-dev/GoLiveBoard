import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ModelTriage, fromLabels } from "../domain/prompt.js";
import { checkSuggestions } from "../domain/suggestions.js";
import { EVAL_CASES, PASSING_MEAN_SCORE } from "./cases.js";
import {
  promptOfCase,
  type Recording,
  recordingFile,
  recordingHash,
} from "./recording.js";
import { scoreCase } from "./score.js";

async function recorded(file: string): Promise<Recording> {
  const text = await readFile(
    new URL(`recordings/${file}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(text) as Recording;
}

/**
 * The evaluation suite (docs/07, M8 exit criteria): the model's recorded
 * answers to fixed cases, scored against the groups a moderator would make,
 * with no call to the model. Re-record with `npm run eval:record`.
 */
describe("the triage evaluation suite, on recorded answers", () => {
  const scores = new Map<string, number>();

  it.each(
    EVAL_CASES.map(
      (evalCase, index) => [evalCase.name, evalCase, index] as const,
    ),
  )("%s", async (_name, evalCase, index) => {
    const recording = await recorded(recordingFile(evalCase));
    const { prompt, ids, keyOf } = promptOfCase(evalCase, index);

    // Made from today's instructions and questions.
    expect(
      recording.hash,
      `${evalCase.name} was recorded from another prompt: re-record (npm run eval:record)`,
    ).toBe(recordingHash(recording.model, prompt.user));
    const check = checkSuggestions(
      ids,
      fromLabels(ModelTriage.parse(recording.output), prompt.labels),
    );
    expect(check.ok ? [] : check.problems).toEqual([]);
    if (!check.ok) {
      return;
    }
    const result = scoreCase(
      evalCase.expectedGroups,
      check.suggestions,
      keyOf,
      evalCase.mustStayAlone,
    );
    expect(result.brokenRules).toEqual([]);
    scores.set(evalCase.name, result.score);
  });

  it(`scores at least ${String(PASSING_MEAN_SCORE)} on average`, () => {
    const all = EVAL_CASES.map(({ name }) => scores.get(name) ?? 0);
    const mean = all.reduce((sum, score) => sum + score, 0) / all.length;
    // Each case's score, shown when the mean falls short.
    const table = [
      ...EVAL_CASES.map(
        ({ name }) => `${name}: ${(scores.get(name) ?? 0).toFixed(2)}`,
      ),
      `mean: ${mean.toFixed(2)}`,
    ].join("\n");
    expect(mean, table).toBeGreaterThanOrEqual(PASSING_MEAN_SCORE);
  });
});
