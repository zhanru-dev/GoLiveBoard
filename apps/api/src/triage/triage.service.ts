import { Inject, Injectable } from "@nestjs/common";
import {
  type TriageDecisionRequest,
  type TriageRequestedPayload,
  type TriageRun,
  TriageSuggestions,
} from "@opspilot/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { isDemoWorkspace } from "../demo/demo-workspace.js";
import { lockWritableEvent } from "../events/event-lock.queries.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { QuestionsService } from "../live/questions.service.js";
import { writeOutbox } from "../outbox/outbox.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { DEMO_TIME_ZONE, demoMayRun, startOfDay } from "./domain/budget.js";
import { acceptedGroupsExist, planMerges } from "./domain/merge.js";
import { TRIAGE_MAX_QUESTIONS } from "./domain/prompt.js";
import { TRIAGE_MODEL, type TriageModel } from "./triage-model.js";
import { TRIAGE_RUN_SELECT, toTriageRun } from "./triage-view.js";

/**
 * AI question triage as moderators use it (FR-RN-6, ADR-0012): ask for
 * suggestions, read them, and decide which groups to merge. The model runs
 * in the worker; nothing changes until a moderator decides.
 */
@Injectable()
export class TriageService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TRIAGE_MODEL) private readonly model: TriageModel | null,
    private readonly questions: QuestionsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Asks for suggestions on the event's open questions (pending and
   * published, not merged; the newest 200). While a run is queued or
   * running, asking again returns it.
   *
   * @throws DomainError `TRIAGE_UNAVAILABLE`, `NOT_FOUND`, `EVENT_ARCHIVED`,
   * `RATE_LIMITED`, `TRIAGE_BUDGET_SPENT`, `TRIAGE_NOTHING_TO_SORT`
   */
  async start(actor: Actor, eventId: string): Promise<{ id: string }> {
    if (this.model === null) {
      throw new DomainError("TRIAGE_UNAVAILABLE");
    }
    await this.assertEventVisible(actor, eventId);
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const active = await tx.triageRun.findFirst({
        where: { eventId, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      });
      if (active !== null) {
        return active;
      }
      // Counted only for a run that will start: asking again is free.
      await this.rateLimiter.consumeOrThrow(
        RATE_LIMITS.triagePerEvent,
        `${actor.workspaceId}:${eventId}`,
      );
      if (isDemoWorkspace(actor.workspaceId)) {
        // One budget check at a time, so two runs cannot both fit.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`triage-budget:${actor.workspaceId}`}))`;
        const since = startOfDay(this.clock.now(), DEMO_TIME_ZONE);
        const [spent] = await tx.$queryRaw<
          { runs: number; cost_micros: number }[]
        >`
          SELECT count(*)::int AS runs, coalesce(sum(run.cost_micros), 0)::int AS cost_micros
          FROM triage_runs AS run
          JOIN events AS event ON event.id = run.event_id
          WHERE event.workspace_id = ${actor.workspaceId}::uuid
            AND run.created_at >= ${since}`;
        if (
          !demoMayRun({
            runs: spent?.runs ?? 0,
            costMicros: spent?.cost_micros ?? 0,
          })
        ) {
          throw new DomainError("TRIAGE_BUDGET_SPENT");
        }
      }
      const open = await tx.question.findMany({
        where: {
          eventId,
          status: { in: ["PENDING", "PUBLISHED"] },
          mergedIntoId: null,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: TRIAGE_MAX_QUESTIONS,
        select: { id: true },
      });
      if (open.length === 0) {
        throw new DomainError("TRIAGE_NOTHING_TO_SORT");
      }
      const run = await tx.triageRun.create({
        data: {
          eventId,
          requestedById: actor.userId,
          questionIds: open.map(({ id }) => id),
          createdAt: this.clock.now(),
        },
        select: { id: true },
      });
      const payload: TriageRequestedPayload = { runId: run.id };
      await writeOutbox(tx, {
        workspaceId: actor.workspaceId,
        type: "triage.requested",
        payload,
      });
      return run;
    });
  }

  /** @throws DomainError `NOT_FOUND` */
  async get(actor: Actor, runId: string): Promise<TriageRun> {
    const row = await this.prisma.triageRun.findFirst({
      where: { id: runId, event: { workspaceId: actor.workspaceId } },
      select: TRIAGE_RUN_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return toTriageRun(row);
  }

  /**
   * Merges the accepted groups' questions into their representatives, in
   * one transaction under the event's lock, against the questions as they
   * are now (one merged or deleted since is skipped). Decided once; audited.
   *
   * @throws DomainError `NOT_FOUND`, `EVENT_ARCHIVED`,
   * `TRIAGE_ALREADY_DECIDED`, `VALIDATION_FAILED`
   */
  async decide(
    actor: Actor,
    runId: string,
    request: TriageDecisionRequest,
  ): Promise<TriageRun> {
    const found = await this.prisma.triageRun.findFirst({
      where: { id: runId, event: { workspaceId: actor.workspaceId } },
      select: { eventId: true },
    });
    if (found === null) {
      throw new DomainError("NOT_FOUND");
    }
    const { eventId } = found;
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      await tx.$queryRaw`SELECT id FROM triage_runs WHERE id = ${runId}::uuid FOR UPDATE`;
      const run = await tx.triageRun.findUniqueOrThrow({
        where: { id: runId },
        select: { status: true, decision: true, suggestions: true },
      });
      if (run.status !== "SUCCEEDED" || run.decision !== "PENDING") {
        throw new DomainError("TRIAGE_ALREADY_DECIDED");
      }
      const suggestions = TriageSuggestions.parse(run.suggestions);
      if (!acceptedGroupsExist(suggestions, request.acceptedGroups)) {
        throw new DomainError("VALIDATION_FAILED", {
          errors: [
            {
              path: "acceptedGroups",
              code: "unknown_group",
              message: "Name only groups of these suggestions",
            },
          ],
        });
      }
      const named = request.acceptedGroups.flatMap(
        (index) => suggestions.groups[index]?.questionIds ?? [],
      );
      const now = await tx.question.findMany({
        where: { eventId, id: { in: named } },
        select: { id: true, mergedIntoId: true },
      });
      const plan = planMerges(suggestions, request.acceptedGroups, now);
      const announcements = await this.questions.mergeIn(
        tx,
        eventId,
        plan.merges,
      );
      const row = await tx.triageRun.update({
        where: { id: runId },
        data: {
          decision: plan.decision,
          decidedById: actor.userId,
          decidedAt: this.clock.now(),
        },
        select: TRIAGE_RUN_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "question_triage.decided",
        targetType: "question_triage_run",
        targetId: runId,
        eventId,
        after: {
          decision: plan.decision,
          acceptedGroups: [...request.acceptedGroups].sort((a, b) => a - b),
          merged: plan.merges.map(({ questionId, into }) => ({
            questionId,
            into,
          })),
        },
      });
      return { row, announcements };
    });
    await this.questions.announce(eventId, outcome.announcements);
    return toTriageRun(outcome.row);
  }

  private async assertEventVisible(actor: Actor, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
  }
}
