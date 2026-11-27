import { Inject, Injectable } from "@nestjs/common";
import type {
  EventDetail,
  EventStatus,
  EventTransitionedPayload,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import {
  allowedTransitions,
  planTransition,
} from "../events/domain/lifecycle.js";
import { lockEvent } from "../events/event-lock.queries.js";
import { EventsService } from "../events/events.service.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { closeOpenPolls } from "../live/polls.queries.js";
import { RealtimeSignals } from "../live/realtime-signals.js";
import { writeOutbox } from "../outbox/outbox.js";
import { recordReport } from "../reports/report-store.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import {
  assessReadiness,
  type ReadinessAssessment,
} from "./domain/readiness.js";
import { loadReadinessInput } from "./readiness-input.js";

/** FR-EV-2 and FR-LC-3: moving an event through its lifecycle. */
@Injectable()
export class TransitionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: EventsService,
    private readonly signals: RealtimeSignals,
  ) {}

  /**
   * Applies one transition in one transaction (docs/03 section 2):
   *
   * 1. lock the event row, so concurrent transitions of this event and
   *    changes to what readiness reads wait for each other;
   * 2. check the move is allowed from the status read under that lock;
   * 3. for `READY` and `LIVE`, assess readiness from the current data and
   *    refuse while any hard blocker remains;
   * 4. update the status, and record the audit entry (with the readiness
   *    result) and the outbox message, all committing together.
   *
   * @throws DomainError `ILLEGAL_TRANSITION` (with the allowed moves) or
   * `EVENT_HAS_BLOCKERS` (with the blockers), both `409`
   */
  async transition(
    actor: Actor,
    eventId: string,
    to: EventStatus,
  ): Promise<EventDetail> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, actor.workspaceId, eventId);
      if (event === undefined) {
        throw new DomainError("NOT_FOUND");
      }
      const from = event.status;
      const plan = planTransition(from, to);
      if (!plan.allowed) {
        throw new DomainError("ILLEGAL_TRANSITION", {
          detail: `An event in ${from} cannot move to ${to}.`,
          extensions: { from, to, allowed: allowedTransitions(from) },
        });
      }
      const now = this.clock.now();
      const readiness =
        plan.gate === "NO_HARD_BLOCKERS"
          ? await this.assertNoHardBlockers(tx, eventId, to, now)
          : undefined;

      await tx.event.update({
        where: { id: eventId },
        data: {
          status: to,
          version: { increment: 1 },
          updatedAt: now,
          ...(to === "COMPLETED" && { completedAt: now }),
        },
      });
      if (to === "COMPLETED" || to === "CANCELLED") {
        // Interaction ends: an open poll closes with it (FR-RN-8).
        await closeOpenPolls(tx, actor, eventId, to, now);
      }
      if (to === "COMPLETED") {
        // The audience figures, now final (FR-RC-3).
        await recordReport(tx, eventId, now);
      }
      await recordAudit(tx, actor, {
        action: "event.transitioned",
        targetType: "event",
        targetId: eventId,
        eventId,
        before: { status: from },
        after: {
          status: to,
          ...(readiness !== undefined && {
            readiness: {
              ruleVersion: readiness.ruleVersion,
              score: readiness.score,
            },
          }),
        },
      });
      const payload: EventTransitionedPayload = {
        eventId,
        from,
        to,
        occurredAt: now.toISOString(),
      };
      await writeOutbox(tx, {
        workspaceId: actor.workspaceId,
        type: "event.transitioned",
        payload,
      });
      const detail = await this.events.getWith(tx, actor, eventId);
      // The watch page switches to the stream (FR-RN-1); a cancelled or
      // archived event ends its live connections.
      await this.signals.statusChanged(tx, eventId, detail.slug, to);
      return detail;
    });
  }

  private async assertNoHardBlockers(
    tx: Prisma.TransactionClient,
    eventId: string,
    to: EventStatus,
    now: Date,
  ): Promise<ReadinessAssessment> {
    const assessment = assessReadiness(
      await loadReadinessInput(tx, eventId, now),
    );
    if (assessment.blockers.length > 0) {
      throw new DomainError("EVENT_HAS_BLOCKERS", {
        detail: `Resolve the blockers before moving the event to ${to}.`,
        extensions: { blockers: assessment.blockers },
      });
    }
    return assessment;
  }
}
