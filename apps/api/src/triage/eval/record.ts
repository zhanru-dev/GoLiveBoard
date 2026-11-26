/**
 * Records the model's answers to the evaluation cases (ADR-0012), for CI
 * to score without calling the model. Calls the real model, which costs
 * money: run it on purpose, before a release or after a prompt or model
 * change.
 *
 *   ANTHROPIC_API_KEY=… npm run eval:record -w @goliveboard/api
 *
 * It writes src/triage/eval/recordings/*.json and prints each case's score.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AnthropicTriageModel } from "../anthropic-triage-model.js";
import { costMicros } from "../domain/pricing.js";
import { fromLabels } from "../domain/prompt.js";
import { checkSuggestions } from "../domain/suggestions.js";
import { EVAL_CASES } from "./cases.js";
import {
  promptOfCase,
  type Recording,
  recordingFile,
  recordingHash,
} from "./recording.js";
import { scoreCase } from "./score.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey === "") {
  process.stderr.write(
    "Set ANTHROPIC_API_KEY to record (this calls the real model).\n",
  );
  process.exit(1);
}
const modelName = process.env.AI_TRIAGE_MODEL ?? "claude-opus-5-5";
const model = new AnthropicTriageModel(modelName, apiKey);
// The source folder, also when run from dist/.
const folder = fileURLToPath(
  new URL("../../../src/triage/eval/recordings/", import.meta.url),
);
await mkdir(folder, { recursive: true });

let totalMicros = 0;
for (const [index, evalCase] of EVAL_CASES.entries()) {
  const { prompt, ids, keyOf } = promptOfCase(evalCase, index);
  const started = performance.now();
  const answer = await model.triage(prompt.user, AbortSignal.timeout(60_000));
  const latencyMs = Math.round(performance.now() - started);
  const recording: Recording = {
    case: evalCase.name,
    model: answer.model,
    hash: recordingHash(answer.model, prompt.user),
    output: answer.output,
    usage: answer.usage,
    latencyMs,
    recordedAt: new Date().toISOString(),
  };
  await writeFile(
    `${folder}${recordingFile(evalCase)}`,
    `${JSON.stringify(recording, null, 2)}\n`,
  );
  const check = checkSuggestions(ids, fromLabels(answer.output, prompt.labels));
  const score = check.ok
    ? scoreCase(
        evalCase.expectedGroups,
        check.suggestions,
        keyOf,
        evalCase.mustStayAlone,
      ).score
    : 0;
  totalMicros += costMicros(answer.attempts);
  process.stdout.write(
    `${evalCase.name}: score ${score.toFixed(2)}, ${String(latencyMs)} ms, ${answer.model}\n`,
  );
}
process.stdout.write(`Cost: $${(totalMicros / 1_000_000).toFixed(4)}\n`);
