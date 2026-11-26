import { Inject, Injectable } from "@nestjs/common";
import type {
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookDeliveryQuery,
} from "@goliveboard/contracts";
import { z } from "zod";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { decodeCursor, encodeCursor } from "../http/cursor.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

const Position = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

const DELIVERY_SELECT = {
  id: true,
  endpointId: true,
  eventId: true,
  eventType: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  createdAt: true,
  history: {
    orderBy: { attemptedAt: "asc" },
    select: {
      attemptedAt: true,
      statusCode: true,
      durationMs: true,
      error: true,
    },
  },
} as const satisfies Prisma.WebhookDeliverySelect;

type DeliveryRow = Prisma.WebhookDeliveryGetPayload<{
  select: typeof DELIVERY_SELECT;
}>;

/** What was sent where, and resending it (FR-RC-2): Owners only. */
@Injectable()
export class WebhookDeliveriesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Newest first, with every attempt. */
  async list(
    actor: Actor,
    query: WebhookDeliveryQuery,
  ): Promise<WebhookDeliveryPage> {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, Position);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        endpoint: { workspaceId: actor.workspaceId },
        ...(query.endpointId !== undefined && { endpointId: query.endpointId }),
        ...(query.status !== undefined && { status: query.status }),
        ...(after !== undefined && {
          OR: [
            { createdAt: { lt: new Date(after.createdAt) } },
            { createdAt: new Date(after.createdAt), id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: DELIVERY_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toWebhookDelivery),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * Starts a new round of attempts for a delivery that succeeded or failed:
   * the same webhook `id` and body, so receivers that already have it can
   * ignore it. Of two resends at once, one starts the round and the other
   * gets `409`, as does a resend of a delivery still being tried.
   *
   * @throws DomainError `NOT_FOUND`, `DELIVERY_PENDING`
   */
  async redeliver(actor: Actor, deliveryId: string): Promise<WebhookDelivery> {
    return this.prisma.$transaction(async (tx) => {
      // Its endpoint may not be deleted under it: a resend that waited for
      // the delete finds nothing (`404`), not a delivery "still pending".
      const found = await tx.$queryRaw<{ id: string }[]>`
        SELECT delivery.id
        FROM webhook_deliveries AS delivery
        JOIN webhook_endpoints AS endpoint ON endpoint.id = delivery.endpoint_id
        WHERE delivery.id = ${deliveryId}::uuid
          AND endpoint.workspace_id = ${actor.workspaceId}::uuid
        FOR KEY SHARE OF endpoint`;
      if (found.length === 0) {
        throw new DomainError("NOT_FOUND");
      }
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: deliveryId, status: { not: "PENDING" } },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: this.clock.now(),
        },
      });
      if (count === 0) {
        throw new DomainError("DELIVERY_PENDING");
      }
      await recordAudit(tx, actor, {
        action: "webhook_delivery.redelivered",
        targetType: "webhook_delivery",
        targetId: deliveryId,
      });
      return toWebhookDelivery(
        await tx.webhookDelivery.findUniqueOrThrow({
          where: { id: deliveryId },
          select: DELIVERY_SELECT,
        }),
      );
    });
  }
}

export function toWebhookDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType as WebhookDelivery["eventType"],
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    history: row.history.map((attempt) => ({
      attemptedAt: attempt.attemptedAt.toISOString(),
      statusCode: attempt.statusCode,
      durationMs: attempt.durationMs,
      error: attempt.error,
    })),
  };
}
