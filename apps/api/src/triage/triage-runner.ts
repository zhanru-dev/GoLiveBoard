import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { costMicros } from "./domain/pricing.js";
import { fromLabels, promptFor } from "./domain/prompt.js";
import { checkSuggestions } from "./domain/suggestions.js";
import {
  TRIAGE_MODEL,
  type TriageModel,
  TriageModelError,
} from "./triage-model.js";

/** FR-RN-6: a run that has not answered in 8 seconds has failed. */
export const TRIAGE_TIMEOUT_MS = 8_000;
/**
 * A run still RUNNING this long after it started lost its worker; one
 * still QUEUED this long lost its job. The sweep closes both, so a new run
 * can start (one at a time per event).
 */
export const RUNNING_FOR_TOO_LONG_MS = 60_000;
export const QUEUED_FOR_TOO_LONG_MS = 5 * 60_000;

class TimedOut extends Error {}

/**
 * Carries out triage runs in the worker (ADR-0012): the questions' labels
 * and text go to the model, the answer is checked against the questions it
 * was given, and the run records what happened. Whatever the model does,
 * Q&A is untouched: a run only ever writes itself.
 */
@Injectable()
export class TriageRunner {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TRIAGE_MODEL) private readonly model: TriageModel | null,
    @InjectPinoLogger(TriageRunner.name) private readonly logger: PinoLogger,
  ) {}

  /** Runs a queued run once; a run already taken is left alone. */
  async run(runId: string): Promise<void> {
    const { count } = await this.prisma.triageRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: this.clock.now() },
    });
    if (count === 0) {
      return;
    }
    const run = await this.prisma.triageRun.findUniqueOrThrow({
      where: { id: runId },
      select: { questionIds: true },
    });
    if (this.model === null) {
      await this.fail(runId, "FAILED", "AI suggestions are switched off");
      return;
    }
    // As they are now: one deleted since is not sent.
    const rows = await this.prisma.question.findMany({
      where: { id: { in: run.questionIds } },
      select: { id: true, body: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.body]));
    const questions = run.questionIds.flatMap((id) => {
      const text = byId.get(id);
      return text === undefined ? [] : [{ id, text }];
    });
    const prompt = promptFor(questions);
    const started = performance.now();
    const signal = AbortSignal.timeout(TRIAGE_TIMEOUT_MS);
    try {
      const answer = await Promise.race([
        this.model.triage(prompt.user, signal),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new TimedOut());
          });
        }),
      ]);
      const latencyMs = Math.round(performance.now() - started);
      const recorded = {
        model: answer.model,
        latencyMs,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
        costMicros: costMicros(answer.model, answer.usage),
      };
      const check = checkSuggestions(
        questions.map(({ id }) => id),
        fromLabels(answer.output, prompt.labels),
      );
      if (!check.ok) {
        this.logger.warn(
          { runId, problems: check.problems },
          "Triage suggestions failed their check",
        );
        await this.fail(
          runId,
          "FAILED",
          "The AI model's suggestions did not match the questions",
          recorded,
        );
        return;
      }
      await this.prisma.triageRun.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          suggestions: check.suggestions,
          finishedAt: this.clock.now(),
          ...recorded,
        },
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      if (error instanceof TimedOut || signal.aborted) {
        await this.fail(
          runId,
          "TIMED_OUT",
          "The AI model did not answer within 8 seconds",
          { latencyMs },
        );
        return;
      }
      if (error instanceof TriageModelError) {
        await this.fail(runId, "FAILED", error.message, { latencyMs });
        return;
      }
      this.logger.error({ err: error, runId }, "Triage run failed");
      await this.fail(runId, "FAILED", "AI suggestions are unavailable", {
        latencyMs,
      });
    }
  }

  /**
   * Closes runs a worker left unfinished: running for over a minute, or
   * queued for over five.
   *
   * @returns how many it closed
   */
  async sweep(): Promise<number> {
    const now = this.clock.now().getTime();
    const [running, queued] = await Promise.all([
      this.prisma.triageRun.updateMany({
        where: {
          status: "RUNNING",
          startedAt: { lt: new Date(now - RUNNING_FOR_TOO_LONG_MS) },
        },
        data: {
          status: "TIMED_OUT",
          failure: "The run was interrupted",
          finishedAt: new Date(now),
        },
      }),
      this.prisma.triageRun.updateMany({
        where: {
          status: "QUEUED",
          createdAt: { lt: new Date(now - QUEUED_FOR_TOO_LONG_MS) },
        },
        data: {
          status: "FAILED",
          failure: "The run never started",
          finishedAt: new Date(now),
        },
      }),
    ]);
    return running.count + queued.count;
  }

  private async fail(
    runId: string,
    status: "FAILED" | "TIMED_OUT",
    failure: string,
    recorded: {
      model?: string;
      latencyMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      costMicros?: number | null;
    } = {},
  ): Promise<void> {
    await this.prisma.triageRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status, failure, finishedAt: this.clock.now(), ...recorded },
    });
  }
}
