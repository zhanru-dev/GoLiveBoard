import { Inject, Injectable } from "@nestjs/common";
import {
  type TriageDecisionRequest,
  type TriageRequestedPayload,
  type TriageRun,
  TriageSuggestions,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
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
import {
  type DailyLimit,
  dateIn,
  DEMO_LIMIT,
  DEMO_TIME_ZONE,
  mayRun,
  reserveMicros,
} from "./domain/budget.js";
import { HIGHEST_PRICE } from "./domain/pricing.js";
import { dayValue, lockDay, reserve } from "./spend-ledger.js";
import { acceptedGroupsExist, planMerges } from "./domain/merge.js";
import { promptFor, TRIAGE_MAX_QUESTIONS } from "./domain/prompt.js";
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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
      const open = await tx.question.findMany({
        where: {
          eventId,
          status: { in: ["PENDING", "PUBLISHED"] },
          mergedIntoId: null,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: TRIAGE_MAX_QUESTIONS,
        select: { id: true, body: true },
      });
      if (open.length === 0) {
        throw new DomainError("TRIAGE_NOTHING_TO_SORT");
      }
      // Counted before the workspace's day is locked, so a slow Valkey
      // holds up this event only.
      await this.rateLimiter.consumeOrThrow(
        RATE_LIMITS.triagePerEvent,
        `${actor.workspaceId}:${eventId}`,
      );
      // The day's spend, locked: budget checks run one at a time, and a
      // run reserves its worst cost so runs at once cannot all fit.
      const day = dateIn(this.clock.now(), DEMO_TIME_ZONE);
      const reserved = reserveMicros(
        Buffer.byteLength(
          promptFor(open.map(({ id, body }) => ({ id, text: body }))).user,
        ),
        open.length,
        HIGHEST_PRICE,
      );
      const spent = await lockDay(tx, actor.workspaceId, day);
      const limit = this.limitFor(actor.workspaceId);
      if (limit !== undefined && !mayRun(spent, reserved, limit)) {
        throw new DomainError("TRIAGE_BUDGET_SPENT");
      }
      const run = await tx.triageRun.create({
        data: {
          eventId,
          requestedById: actor.userId,
          questionIds: open.map(({ id }) => id),
          reservedMicros: reserved,
          spendDay: dayValue(day),
          createdAt: this.clock.now(),
        },
        select: { id: true },
      });
      await reserve(tx, actor.workspaceId, day, reserved);
      const payload: TriageRequestedPayload = { runId: run.id };
      await writeOutbox(tx, {
        workspaceId: actor.workspaceId,
        type: "triage.requested",
        payload,
      });
      return run;
    });
  }

  /**
   * The event's most recent run, so a moderator who comes back finds it.
   *
   * @throws DomainError `NOT_FOUND` for an event outside the workspace, or
   * one never triaged
   */
  async latest(actor: Actor, eventId: string): Promise<TriageRun> {
    const row = await this.prisma.triageRun.findFirst({
      where: { eventId, event: { workspaceId: actor.workspaceId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: TRIAGE_RUN_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return toTriageRun(row);
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
        select: { id: true, status: true, mergedIntoId: true },
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
          mergedCount: plan.merges.length,
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

  /** The demo's limit, the configured one for others, or none. */
  private limitFor(workspaceId: string): DailyLimit | undefined {
    if (isDemoWorkspace(workspaceId)) {
      return DEMO_LIMIT;
    }
    const micros = this.config.triage.dailyBudgetMicros;
    return micros === undefined ? undefined : { micros };
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
