import { z } from "zod";

import { EventStatus } from "./events.js";

/**
 * Outbox message types (ADR-0007): what happened, written in the same
 * transaction as the change, then turned into jobs by the worker's relay.
 */
export const OutboxMessageType = z.enum(["event.transitioned"]);
export type OutboxMessageType = z.infer<typeof OutboxMessageType>;

/** An event moved between lifecycle statuses (FR-EV-2). */
export const EventTransitionedPayload = z.object({
  eventId: z.uuid(),
  from: EventStatus,
  to: EventStatus,
  occurredAt: z.iso.datetime(),
});
export type EventTransitionedPayload = z.infer<typeof EventTransitionedPayload>;
