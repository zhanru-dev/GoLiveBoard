import { z } from "zod";

import { EventStatus } from "./events.js";

/**
 * Outbox message types (ADR-0007): what happened, written in the same
 * transaction as the change, then turned into jobs by the worker's relay.
 */
export const OutboxMessageType = z.enum([
  "event.transitioned",
  "stream.check_requested",
  "demo.events_deleted",
]);
export type OutboxMessageType = z.infer<typeof OutboxMessageType>;

/** An event moved between lifecycle statuses (FR-EV-2). */
export const EventTransitionedPayload = z.object({
  eventId: z.uuid(),
  from: EventStatus,
  to: EventStatus,
  occurredAt: z.iso.datetime(),
});
export type EventTransitionedPayload = z.infer<typeof EventTransitionedPayload>;

/** A manager set the stream URL or asked for a check now. */
export const StreamCheckRequestedPayload = z.object({
  eventId: z.uuid(),
  requestedAt: z.iso.datetime(),
});
export type StreamCheckRequestedPayload = z.infer<
  typeof StreamCheckRequestedPayload
>;

/**
 * The nightly demo reset deleted these events (FR-AUTH-5). Their files are
 * deleted again once every upload link handed out for them has expired.
 */
export const DemoEventsDeletedPayload = z.object({
  eventIds: z.array(z.uuid()).max(10_000),
});
export type DemoEventsDeletedPayload = z.infer<typeof DemoEventsDeletedPayload>;

/**
 * Data of a `check` job on the stream-checks queue. `slot` is the time the
 * check was scheduled for; one check is recorded per event and slot.
 */
export const CheckStreamJob = z.object({
  eventId: z.uuid(),
  slot: z.iso.datetime(),
});
export type CheckStreamJob = z.infer<typeof CheckStreamJob>;
