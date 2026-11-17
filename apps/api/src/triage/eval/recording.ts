import { createHash } from "node:crypto";

import { promptFor, TRIAGE_SYSTEM_PROMPT } from "../domain/prompt.js";
import type { EvalCase } from "./cases.js";

/** A stable ID per key, so a case's prompt is the same on every machine. */
export function idOf(caseIndex: number, keyIndex: number): string {
  const hex = (caseIndex * 1000 + keyIndex + 1).toString(16).padStart(12, "0");
  return `00000000-0000-7000-8000-${hex}`;
}

/** The prompt a case sends, and how to read IDs back to its keys. */
export function promptOfCase(evalCase: EvalCase, caseIndex: number) {
  const keys = Object.keys(evalCase.questions);
  const questions = keys.map((key, keyIndex) => ({
    id: idOf(caseIndex, keyIndex),
    text: evalCase.questions[key] ?? "",
  }));
  const keyById = new Map(
    questions.map(({ id }, index) => [id, keys[index] ?? ""]),
  );
  return {
    prompt: promptFor(questions),
    ids: questions.map(({ id }) => id),
    keyOf: (id: string) => keyById.get(id) ?? id,
  };
}

/**
 * What a recording was made from: the model, the instructions and the
 * case's questions. Any change and the recording no longer counts.
 */
export function recordingHash(model: string, user: string): string {
  return createHash("sha256")
    .update(`${model}\n${TRIAGE_SYSTEM_PROMPT}\n${user}`)
    .digest("hex");
}

/** One case's recorded answer, as committed under recordings/. */
export interface Recording {
  readonly case: string;
  readonly model: string;
  readonly hash: string;
  readonly output: unknown;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly latencyMs: number;
  readonly recordedAt: string;
}

/** The file a case's recording lives in. */
export function recordingFile(evalCase: EvalCase): string {
  return `${evalCase.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.json`;
}
