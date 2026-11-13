import { Inject, Injectable } from "@nestjs/common";
import {
  type CreateEventRequest,
  END_AFTER_START_MESSAGE,
  EventDetail,
  type EventPage,
  type ListEventsQuery,
  type UpdateEventRequest,
} from "@opspilot/contracts";
import { z } from "zod";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { decodeCursor, encodeCursor } from "../http/cursor.js";
import { Idempotency } from "../idempotency/idempotency.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { assertWorkspaceMember } from "../workspaces/membership-check.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { isReadOnly } from "./domain/lifecycle.js";
import { eventSlug } from "./domain/slug.js";
import {
  editableFields,
  EVENT_SELECT,
  type EventRow,
  toEventDetail,
  toEventSummary,
} from "./event-view.js";
import { escapeLikePattern } from "./like-pattern.js";
import { randomSlugSuffix } from "./slug-suffix.js";

/** Where the last item of a page sits in the list's sort order. */
const ListPosition = z.object({ startsAt: z.iso.datetime(), id: z.uuid() });

export interface CreatedEvent {
  readonly event: EventDetail;
  /** True when this was a retry and the original response is returned. */
  readonly replayed: boolean;
}

/** FR-EV-1, FR-EV-3 and FR-EV-4. Every query is scoped by the actor's workspace. */
@Injectable()
export class EventsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly idempotency: Idempotency,
  ) {}

  /**
   * Keyset pagination on (startsAt, id), newest start first: unlike an
   * offset, a cursor stays correct while events are added, and every page
   * costs the same index range scan.
   */
  async list(actor: Actor, query: ListEventsQuery): Promise<EventPage> {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, ListPosition);
    const conditions: Prisma.EventWhereInput[] = [
      { workspaceId: actor.workspaceId },
    ];
    if (query.q !== undefined) {
      conditions.push({
        title: { contains: escapeLikePattern(query.q), mode: "insensitive" },
      });
    }
    if (query.status !== undefined) {
      conditions.push({ status: { in: query.status } });
    }
    if (query.from !== undefined) {
      conditions.push({ startsAt: { gte: new Date(query.from) } });
    }
    if (query.to !== undefined) {
      conditions.push({ startsAt: { lt: new Date(query.to) } });
    }
    if (after !== undefined) {
      const startsAt = new Date(after.startsAt);
      conditions.push({
        OR: [
          { startsAt: { lt: startsAt } },
          { startsAt, id: { lt: after.id } },
        ],
      });
    }
    // One extra row tells whether another page follows.
    const rows = await this.prisma.event.findMany({
      where: { AND: conditions },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: EVENT_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toEventSummary),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ startsAt: last.startsAt.toISOString(), id: last.id })
          : null,
    };
  }

  async get(actor: Actor, eventId: string): Promise<EventDetail> {
    return this.getWith(this.prisma, actor, eventId);
  }

  /** Reads an event through the given client, e.g. inside a transaction. */
  async getWith(
    client: Prisma.TransactionClient,
    actor: Actor,
    eventId: string,
  ): Promise<EventDetail> {
    return toEventDetail(await this.findOrThrow(client, actor, eventId));
  }

  /**
   * Creates a `DRAFT` event. With an idempotency key, a retried request
   * returns the first response instead of creating a second event.
   */
  async create(
    actor: Actor,
    input: CreateEventRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreatedEvent> {
    if (input.ownerUserId !== null) {
      await assertWorkspaceMember(
        this.prisma,
        actor.workspaceId,
        input.ownerUserId,
        "ownerUserId",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const work = async () => ({
        status: 201,
        body: await this.insert(tx, actor, input),
      });
      if (idempotencyKey === undefined) {
        return { event: (await work()).body, replayed: false };
      }
      const outcome = await this.idempotency.run(
        tx,
        {
          scope: `${actor.workspaceId}:${actor.userId}:create-event`,
          key: idempotencyKey,
          body: input,
        },
        work,
      );
      return {
        event: EventDetail.parse(outcome.body),
        replayed: outcome.replayed,
      };
    });
  }

  /**
   * Applies a change made from version `expectedVersion`. The version is
   * compared in the UPDATE itself, so of two edits made from the same
   * version exactly one wins and the other gets `412` instead of silently
   * overwriting it (FR-EV-1).
   */
  async update(
    actor: Actor,
    eventId: string,
    expectedVersion: number,
    changes: UpdateEventRequest,
  ): Promise<EventDetail> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findOrThrow(tx, actor, eventId);
      assertWritable(current);
      if (current.version !== expectedVersion) {
        throw new DomainError("VERSION_CONFLICT");
      }
      assertEndsAfterStarts({ ...editableFields(current), ...changes });
      if (changes.ownerUserId !== undefined && changes.ownerUserId !== null) {
        await assertWorkspaceMember(
          tx,
          actor.workspaceId,
          changes.ownerUserId,
          "ownerUserId",
        );
      }

      const { count } = await tx.event.updateMany({
        where: {
          id: eventId,
          workspaceId: actor.workspaceId,
          version: expectedVersion,
          status: { not: "ARCHIVED" },
        },
        data: {
          ...changes,
          version: { increment: 1 },
          updatedAt: this.clock.now(),
        },
      });
      if (count === 0) {
        // Another request committed between our read and this update.
        assertWritable(await this.findOrThrow(tx, actor, eventId));
        throw new DomainError("VERSION_CONFLICT");
      }
      await recordAudit(tx, actor, {
        action: "event.updated",
        targetType: "event",
        targetId: eventId,
        eventId,
        ...changedFields(editableFields(current), changes),
      });
      return toEventDetail(await this.findOrThrow(tx, actor, eventId));
    });
  }

  private async insert(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: CreateEventRequest,
  ): Promise<EventDetail> {
    const now = this.clock.now();
    const row = await tx.event.create({
      data: {
        workspaceId: actor.workspaceId,
        slug: eventSlug(input.title, randomSlugSuffix()),
        title: input.title,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timeZone: input.timeZone,
        ownerUserId: input.ownerUserId,
        expectedAttendance: input.expectedAttendance,
        createdAt: now,
        updatedAt: now,
      },
      select: EVENT_SELECT,
    });
    await recordAudit(tx, actor, {
      action: "event.created",
      targetType: "event",
      targetId: row.id,
      eventId: row.id,
      after: editableFields(row),
    });
    return toEventDetail(row);
  }

  /** Another workspace's event is `404`, so its existence is not revealed. */
  private async findOrThrow(
    client: Prisma.TransactionClient,
    actor: Actor,
    eventId: string,
  ): Promise<EventRow> {
    const row = await client.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: EVENT_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return row;
  }
}

function assertWritable(event: EventRow): void {
  if (isReadOnly(event.status)) {
    throw new DomainError("EVENT_ARCHIVED");
  }
}

/** The request schema checks this for creates; edits need the stored values. */
function assertEndsAfterStarts(schedule: {
  startsAt: string;
  endsAt: string;
}): void {
  if (Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)) {
    throw new DomainError("VALIDATION_FAILED", {
      errors: [
        { path: "endsAt", code: "custom", message: END_AFTER_START_MESSAGE },
      ],
    });
  }
}

/** Before and after values of only the fields an edit actually changes. */
function changedFields(
  current: ReturnType<typeof editableFields>,
  changes: UpdateEventRequest,
): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } {
  const before: Record<string, Prisma.InputJsonValue | null> = {};
  const after: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [field, value] of Object.entries(changes)) {
    const previous = current[field as keyof typeof current];
    if (value !== previous) {
      before[field] = previous;
      after[field] = value;
    }
  }
  return { before, after };
}
