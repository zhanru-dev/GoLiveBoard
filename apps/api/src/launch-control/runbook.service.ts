import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateRunbookTaskRequest,
  RunbookTask,
  UpdateRunbookTaskRequest,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { lockWritableEvent } from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { assertWorkspaceMember } from "../workspaces/membership-check.js";
import { moveAfter } from "./domain/runbook-order.js";
import { renumberTasks } from "./runbook.queries.js";
import {
  TASK_SELECT,
  type TaskRow,
  taskFields,
  toRunbookTask,
} from "./runbook-view.js";

/**
 * FR-LC-1. Every write locks the event row first (see lockEvent), which keeps
 * positions consistent, keeps archived events read-only, and lets a
 * transition's readiness check see the runbook as a whole.
 */
@Injectable()
export class RunbookService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: Actor, eventId: string): Promise<RunbookTask[]> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    return (await this.orderedTasks(this.prisma, eventId)).map(toRunbookTask);
  }

  /** Adds a task at the end of the runbook. */
  async create(
    actor: Actor,
    eventId: string,
    input: CreateRunbookTaskRequest,
  ): Promise<RunbookTask> {
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      if (input.ownerUserId !== null) {
        await assertWorkspaceMember(
          tx,
          actor.workspaceId,
          input.ownerUserId,
          "ownerUserId",
        );
      }
      const count = await tx.runbookTask.count({ where: { eventId } });
      const row = await tx.runbookTask.create({
        data: {
          eventId,
          title: input.title,
          isCritical: input.isCritical,
          ownerUserId: input.ownerUserId,
          dueAt: input.dueAt === null ? null : new Date(input.dueAt),
          position: count + 1,
          createdAt: this.clock.now(),
        },
        select: TASK_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "runbook_task.created",
        targetType: "runbook_task",
        targetId: row.id,
        eventId,
        after: taskFields(row),
      });
      return toRunbookTask(row);
    });
  }

  /**
   * Edits, completes (`status: "DONE"`, recording who and when) or reopens
   * a task, if it is still at `expectedVersion`.
   */
  async update(
    actor: Actor,
    taskId: string,
    expectedVersion: number,
    changes: UpdateRunbookTaskRequest,
  ): Promise<RunbookTask> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockTask(tx, actor, taskId, expectedVersion);
      if (changes.ownerUserId !== undefined && changes.ownerUserId !== null) {
        await assertWorkspaceMember(
          tx,
          actor.workspaceId,
          changes.ownerUserId,
          "ownerUserId",
        );
      }
      const { dueAt, ...rest } = changes;
      const row = await tx.runbookTask.update({
        where: { id: taskId },
        data: {
          ...rest,
          ...(dueAt !== undefined && {
            dueAt: dueAt === null ? null : new Date(dueAt),
          }),
          ...this.completion(actor, current, changes),
          version: { increment: 1 },
        },
        select: TASK_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "runbook_task.updated",
        targetType: "runbook_task",
        targetId: taskId,
        eventId: row.eventId,
        ...changedFields(taskFields(current), taskFields(row)),
      });
      return toRunbookTask(row);
    });
  }

  async remove(
    actor: Actor,
    taskId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockTask(tx, actor, taskId, expectedVersion);
      await tx.runbookTask.delete({ where: { id: taskId } });
      // Close the gap, so positions stay 1, 2, 3…
      await tx.runbookTask.updateMany({
        where: { eventId: current.eventId, position: { gt: current.position } },
        data: { position: { decrement: 1 } },
      });
      await recordAudit(tx, actor, {
        action: "runbook_task.deleted",
        targetType: "runbook_task",
        targetId: taskId,
        eventId: current.eventId,
        before: taskFields(current),
      });
    });
  }

  /**
   * Moves a task after another one (or first) and returns the whole runbook
   * in its new order.
   */
  async move(
    actor: Actor,
    taskId: string,
    afterId: string | null,
  ): Promise<RunbookTask[]> {
    return this.prisma.$transaction(async (tx) => {
      const task = await this.findTask(tx, actor, taskId);
      await lockWritableEvent(tx, actor.workspaceId, task.eventId);
      const tasks = await this.orderedTasks(tx, task.eventId);
      const order = moveAfter(
        tasks.map((candidate) => candidate.id),
        taskId,
        afterId,
      );
      if (order === undefined) {
        throw new DomainError("VALIDATION_FAILED", {
          errors: [
            {
              path: "after",
              code: "invalid_anchor",
              message: "Choose another task of the same runbook.",
            },
          ],
        });
      }
      await renumberTasks(tx, order);
      await recordAudit(tx, actor, {
        action: "runbook_task.moved",
        targetType: "runbook_task",
        targetId: taskId,
        eventId: task.eventId,
        before: { position: task.position },
        after: { position: order.indexOf(taskId) + 1 },
      });
      return (await this.orderedTasks(tx, task.eventId)).map(toRunbookTask);
    });
  }

  /** Who completed a task and when; cleared again when it is reopened. */
  private completion(
    actor: Actor,
    current: TaskRow,
    changes: UpdateRunbookTaskRequest,
  ): Prisma.RunbookTaskUncheckedUpdateInput {
    if (changes.status === undefined || changes.status === current.status) {
      return {};
    }
    return changes.status === "DONE"
      ? { completedAt: this.clock.now(), completedById: actor.userId }
      : { completedAt: null, completedById: null };
  }

  /**
   * Finds a task in the actor's workspace, locks its event and checks the
   * version the client based its change on.
   */
  private async lockTask(
    tx: Prisma.TransactionClient,
    actor: Actor,
    taskId: string,
    expectedVersion: number,
  ): Promise<TaskRow> {
    const found = await this.findTask(tx, actor, taskId);
    await lockWritableEvent(tx, actor.workspaceId, found.eventId);
    // Read again under the lock: the task may have changed or gone meanwhile.
    const current = await this.findTask(tx, actor, taskId);
    if (current.version !== expectedVersion) {
      throw new DomainError("VERSION_CONFLICT");
    }
    return current;
  }

  /** A task of another workspace is `404`, like one that does not exist. */
  private async findTask(
    client: Prisma.TransactionClient,
    actor: Actor,
    taskId: string,
  ): Promise<TaskRow> {
    const row = await client.runbookTask.findFirst({
      where: { id: taskId, event: { workspaceId: actor.workspaceId } },
      select: TASK_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return row;
  }

  private orderedTasks(client: Prisma.TransactionClient, eventId: string) {
    return client.runbookTask.findMany({
      where: { eventId },
      orderBy: { position: "asc" },
      select: TASK_SELECT,
    });
  }
}

type Fields = ReturnType<typeof taskFields>;

/** Before and after values of only the fields that changed. */
function changedFields(
  before: Fields,
  after: Fields,
): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } {
  const changed = (Object.keys(after) as (keyof Fields)[]).filter(
    (field) => before[field] !== after[field],
  );
  return {
    before: Object.fromEntries(changed.map((field) => [field, before[field]])),
    after: Object.fromEntries(changed.map((field) => [field, after[field]])),
  };
}
