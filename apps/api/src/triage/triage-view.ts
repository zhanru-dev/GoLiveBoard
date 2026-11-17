import { TriageSuggestions, type TriageRun } from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";

export const TRIAGE_RUN_SELECT = {
  id: true,
  eventId: true,
  status: true,
  decision: true,
  questionIds: true,
  suggestions: true,
  failure: true,
  model: true,
  latencyMs: true,
  inputTokens: true,
  outputTokens: true,
  costMicros: true,
  createdAt: true,
  finishedAt: true,
} as const satisfies Prisma.TriageRunSelect;

export type TriageRunRow = Prisma.TriageRunGetPayload<{
  select: typeof TRIAGE_RUN_SELECT;
}>;

export function toTriageRun(row: TriageRunRow): TriageRun {
  return {
    id: row.id,
    eventId: row.eventId,
    status: row.status,
    decision: row.decision,
    questionCount: row.questionIds.length,
    suggestions:
      row.suggestions === null
        ? null
        : TriageSuggestions.parse(row.suggestions),
    failure: row.failure,
    model: row.model,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicros: row.costMicros,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
