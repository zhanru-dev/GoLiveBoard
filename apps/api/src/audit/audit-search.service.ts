import { Inject, Injectable } from "@nestjs/common";
import type { AuditEntry, AuditPage, AuditQuery } from "@opspilot/contracts";
import { z } from "zod";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { decodeCursor, encodeCursor } from "../http/cursor.js";

const Position = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

const ENTRY_SELECT = {
  id: true,
  createdAt: true,
  actorKind: true,
  actorUserId: true,
  action: true,
  targetType: true,
  targetId: true,
  eventId: true,
  before: true,
  after: true,
  requestId: true,
  actorUser: { select: { name: true } },
} as const satisfies Prisma.AuditEntrySelect;

/** Searching the audit trail (FR-RC-1, docs/04 section 3.7). */
@Injectable()
export class AuditSearchService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** The actor's workspace only, newest first. */
  async search(actor: Actor, query: AuditQuery): Promise<AuditPage> {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, Position);
    const rows = await this.prisma.auditEntry.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...(query.eventId !== undefined && { eventId: query.eventId }),
        ...(query.actorId !== undefined && { actorUserId: query.actorId }),
        ...(query.action !== undefined && { action: query.action }),
        createdAt: {
          ...(query.from !== undefined && { gte: new Date(query.from) }),
          ...(query.to !== undefined && { lt: new Date(query.to) }),
        },
        ...(after !== undefined && {
          OR: [
            { createdAt: { lt: new Date(after.createdAt) } },
            { createdAt: new Date(after.createdAt), id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: ENTRY_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toAuditEntry),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }
}

function toAuditEntry(
  row: Prisma.AuditEntryGetPayload<{ select: typeof ENTRY_SELECT }>,
): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    actor: {
      kind: row.actorKind,
      userId: row.actorUserId,
      name: row.actorUser?.name ?? null,
    },
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    eventId: row.eventId,
    before: row.before ?? null,
    after: row.after ?? null,
    requestId: row.requestId,
  };
}
