import { z } from "zod";

import { EventStatus } from "./events.js";

/**
 * Outbox message types (ADR-0007): what happened, written in the same
 * transaction as the change, then turned into jobs by the worker's relay.
 */
export const OutboxMessageType = z.enum([
  "event.transitioned",
  "attendee.verified",
  "triage.requested",
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

/**
 * An attendee confirmed their address for the first time: the
 * `attendee.registered` webhook (docs/04, section 6.2). No personal data:
 * the sender adds it when sending, if the workspace allows it.
 */
export const AttendeeVerifiedPayload = z.object({
  eventId: z.uuid(),
  attendeeId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type AttendeeVerifiedPayload = z.infer<typeof AttendeeVerifiedPayload>;

/** A moderator asked for AI triage (FR-RN-6): the run to carry out. */
export const TriageRequestedPayload = z.object({ runId: z.uuid() });
export type TriageRequestedPayload = z.infer<typeof TriageRequestedPayload>;

/** A webhook fan-out job: the outbox message to send as webhooks. */
export const WebhookFanOutJob = z.object({ outboxMessageId: z.uuid() });
export type WebhookFanOutJob = z.infer<typeof WebhookFanOutJob>;

/** A manager set the stream URL or asked for a check now. */
export const StreamCheckRequestedPayload = z.object({
  eventId: z.uuid(),
  requestedAt: z.iso.datetime(),
});
export type StreamCheckRequestedPayload = z.infer<
  typeof StreamCheckRequestedPayload
>;

/**
 * Legacy: an earlier build wrote this when the demo reset deleted events
 * (FR-AUTH-5). Nothing writes it now; the reset records the events' storage
 * prefixes in `pending_file_purges` instead. It is still read, so that
 * messages and jobs left by that build are not lost in an upgrade.
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
