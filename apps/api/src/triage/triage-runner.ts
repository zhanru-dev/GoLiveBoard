import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import type { Prisma } from "../generated/prisma/client.js";
import { maxOutputTokens } from "./domain/budget.js";
import { costMicros } from "./domain/pricing.js";
import { settle, settleOrphans } from "./spend-ledger.js";
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
    // As they are now: one answered, hidden, merged or deleted since is
    // not sent (a moderator hid it for a reason).
    const rows = await this.prisma.question.findMany({
      where: {
        id: { in: run.questionIds },
        status: { in: ["PENDING", "PUBLISHED"] },
        mergedIntoId: null,
      },
      select: { id: true, body: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.body]));
    const questions = run.questionIds.flatMap((id) => {
      const text = byId.get(id);
      return text === undefined ? [] : [{ id, text }];
    });
    if (questions.length === 0) {
      await this.fail(
        runId,
        "FAILED",
        "Every question was answered, hidden or merged before the run",
      );
      return;
    }
    const prompt = promptFor(questions);
    const started = performance.now();
    const signal = AbortSignal.timeout(TRIAGE_TIMEOUT_MS);
    try {
      const answer = await Promise.race([
        this.model.triage(
          prompt.user,
          signal,
          maxOutputTokens(questions.length),
        ),
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
        costMicros: costMicros(answer.attempts),
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
      await this.finish(runId, recorded.costMicros, {
        status: "SUCCEEDED",
        suggestions: check.suggestions,
        finishedAt: this.clock.now(),
        ...recorded,
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      if (error instanceof TimedOut || signal.aborted) {
        // The model may have billed for work it did not finish in time:
        // its worst cost stays counted.
        await this.fail(
          runId,
          "TIMED_OUT",
          "The AI model did not answer within 8 seconds",
          { latencyMs },
          "RESERVED",
        );
        return;
      }
      if (error instanceof TriageModelError) {
        if (error.spent === "UNKNOWN") {
          // Billed for an answer whose usage was lost: its worst cost.
          await this.fail(
            runId,
            "FAILED",
            error.message,
            { latencyMs },
            "RESERVED",
          );
          return;
        }
        // What the provider billed, a refused or cut-off answer included.
        await this.fail(runId, "FAILED", error.message, {
          latencyMs,
          ...(error.spent.length > 0 && {
            model: error.spent.at(-1)?.model,
            inputTokens: error.spent.reduce(
              (sum, { inputTokens }) => sum + inputTokens,
              0,
            ),
            outputTokens: error.spent.reduce(
              (sum, { outputTokens }) => sum + outputTokens,
              0,
            ),
            costMicros: costMicros(error.spent),
          }),
        });
        return;
      }
      // Something unforeseen, perhaps after the provider answered: its
      // worst cost stays counted.
      this.logger.error({ err: error, runId }, "Triage run failed");
      await this.fail(
        runId,
        "FAILED",
        "AI suggestions are unavailable",
        { latencyMs },
        "RESERVED",
      );
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
    const stale = await this.prisma.triageRun.findMany({
      where: {
        OR: [
          {
            status: "RUNNING",
            startedAt: { lt: new Date(now - RUNNING_FOR_TOO_LONG_MS) },
          },
          {
            status: "QUEUED",
            createdAt: { lt: new Date(now - QUEUED_FOR_TOO_LONG_MS) },
          },
        ],
      },
      select: { id: true, status: true, reservedMicros: true },
    });
    let closed = 0;
    for (const run of stale) {
      // A run interrupted while running may have been billed: its worst
      // cost stays counted. One that never started cost nothing.
      const running = run.status === "RUNNING";
      closed += await this.finish(
        run.id,
        running ? run.reservedMicros : 0,
        running
          ? {
              status: "TIMED_OUT",
              failure: "The run was interrupted",
              finishedAt: new Date(now),
            }
          : {
              status: "FAILED",
              failure: "The run never started",
              finishedAt: new Date(now),
            },
        running ? "RUNNING" : "QUEUED",
      );
    }
    await settleOrphans(this.prisma);
    return closed;
  }

  /**
   * Finishes a run that is still in `from`, and settles its day's spend in
   * the same transaction: once, whoever finishes it.
   *
   * @returns 1 when it finished the run, 0 when another did first
   */
  private finish(
    runId: string,
    spentMicros: number | null,
    data: Prisma.TriageRunUpdateManyMutationInput,
    from: "QUEUED" | "RUNNING" = "RUNNING",
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.triageRun.updateMany({
        where: { id: runId, status: from },
        data,
      });
      if (count > 0) {
        await settle(tx, runId, spentMicros ?? 0);
      }
      return count;
    });
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
    spend: "RECORDED" | "RESERVED" = "RECORDED",
  ): Promise<void> {
    const reserved =
      spend === "RESERVED"
        ? (
            await this.prisma.triageRun.findUniqueOrThrow({
              where: { id: runId },
              select: { reservedMicros: true },
            })
          ).reservedMicros
        : (recorded.costMicros ?? 0);
    await this.finish(runId, reserved, {
      status,
      failure,
      finishedAt: this.clock.now(),
      ...recorded,
    });
  }
}
