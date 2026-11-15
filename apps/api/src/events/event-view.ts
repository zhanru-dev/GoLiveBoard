import type { EventDetail, EventSummary } from "@opspilot/contracts";

import type { Prisma } from "../generated/prisma/client.js";
import { allowedTransitions } from "./domain/lifecycle.js";

/** The columns every event response is built from. */
export const EVENT_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  status: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  ownerUserId: true,
  expectedAttendance: true,
  questionsPreModerated: true,
  streamUrl: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
} as const satisfies Prisma.EventSelect;

export type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

export function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timeZone: row.timeZone,
    owner:
      row.owner === null
        ? null
        : { userId: row.owner.id, name: row.owner.name },
  };
}

export function toEventDetail(row: EventRow): EventDetail {
  return {
    ...toEventSummary(row),
    description: row.description,
    streamUrl: row.streamUrl,
    allowedTransitions: allowedTransitions(row.status),
    expectedAttendance: row.expectedAttendance,
    questionsPreModerated: row.questionsPreModerated,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The editable fields of a stored event, as they appear in requests. */
export function editableFields(row: EventRow) {
  return {
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timeZone: row.timeZone,
    ownerUserId: row.ownerUserId,
    expectedAttendance: row.expectedAttendance,
    questionsPreModerated: row.questionsPreModerated,
  };
}
