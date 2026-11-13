import type { RunbookTask } from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";

export const TASK_SELECT = {
  id: true,
  eventId: true,
  title: true,
  isCritical: true,
  status: true,
  position: true,
  ownerUserId: true,
  dueAt: true,
  completedAt: true,
  version: true,
  owner: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.RunbookTaskSelect;

export type TaskRow = Prisma.RunbookTaskGetPayload<{
  select: typeof TASK_SELECT;
}>;

const person = (user: { id: string; name: string } | null) =>
  user === null ? null : { userId: user.id, name: user.name };

export function toRunbookTask(row: TaskRow): RunbookTask {
  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    isCritical: row.isCritical,
    status: row.status,
    position: row.position,
    owner: person(row.owner),
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: person(row.completedBy),
    version: row.version,
  };
}

/** The editable fields of a stored task, as they appear in requests. */
export function taskFields(row: TaskRow) {
  return {
    title: row.title,
    isCritical: row.isCritical,
    ownerUserId: row.ownerUserId,
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
  };
}
