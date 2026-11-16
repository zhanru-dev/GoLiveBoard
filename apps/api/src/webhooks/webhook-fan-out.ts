import { Inject, Injectable } from "@nestjs/common";
import {
  AttendeeVerifiedPayload,
  EventTransitionedPayload,
  type WebhookEventType,
} from "@opspilot/contracts";

import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { webhookTypeForTransition } from "./domain/event-types.js";

interface Webhook {
  readonly type: WebhookEventType;
  readonly occurredAt: Date;
  readonly data: Prisma.InputJsonObject;
}

/**
 * Turns an outbox message into one delivery per active endpoint of its
 * workspace that subscribed to its type (FR-RC-2). Running it twice for one
 * message creates nothing more: one delivery per event and endpoint.
 */
@Injectable()
export class WebhookFanOut {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @returns how many deliveries it created */
  async fanOut(outboxMessageId: string): Promise<number> {
    const message = await this.prisma.outboxMessage.findUnique({
      where: { id: outboxMessageId },
      select: { id: true, workspaceId: true, type: true, payload: true },
    });
    if (message === null) {
      // Deleted since (the demo reset): nothing to send.
      return 0;
    }
    const webhook = await this.webhookFor(message.type, message.payload);
    if (webhook === undefined) {
      return 0;
    }
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        workspaceId: message.workspaceId,
        active: true,
        eventTypes: { has: webhook.type },
      },
      select: { id: true },
    });
    const { count } = await this.prisma.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        eventId: message.id,
        eventType: webhook.type,
        data: webhook.data,
        occurredAt: webhook.occurredAt,
        nextAttemptAt: this.clock.now(),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  private async webhookFor(
    type: string,
    payload: Prisma.JsonValue,
  ): Promise<Webhook | undefined> {
    switch (type) {
      case "event.transitioned": {
        const transition = EventTransitionedPayload.parse(payload);
        const webhookType = webhookTypeForTransition(transition.to);
        if (webhookType === undefined) {
          return undefined;
        }
        const event = await this.prisma.event.findUnique({
          where: { id: transition.eventId },
          select: { title: true, startsAt: true },
        });
        if (event === null) {
          return undefined;
        }
        // docs/04 section 6.1's example payload.
        return {
          type: webhookType,
          occurredAt: new Date(transition.occurredAt),
          data: {
            eventId: transition.eventId,
            title: event.title,
            startsAt: event.startsAt.toISOString(),
          },
        };
      }
      case "attendee.verified": {
        const verified = AttendeeVerifiedPayload.parse(payload);
        return {
          type: "attendee.registered",
          occurredAt: new Date(verified.occurredAt),
          data: {
            eventId: verified.eventId,
            attendeeId: verified.attendeeId,
          },
        };
      }
      default:
        return undefined;
    }
  }
}
