import {
  DemoEventsDeletedPayload,
  TriageRequestedPayload,
  OutboxMessageType,
  StreamCheckRequestedPayload,
} from "@opspilot/contracts";

import type { JobRequest } from "../queues/job-publisher.js";
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  STREAM_CHECK_JOBS,
  STREAM_CHECKS_QUEUE,
  TRIAGE_JOBS,
  TRIAGE_QUEUE,
  WEBHOOK_JOBS,
  WEBHOOKS_QUEUE,
} from "../queues/queues.js";

export interface RelayedMessage {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * The job an outbox message becomes, or `undefined` when nothing consumes
 * that type.
 * The job ID is derived from the message ID, so relaying a message twice
 * enqueues one job.
 *
 * @throws ZodError when a known type carries a malformed payload (a bug in
 * the writer; the relay logs it and leaves the message for inspection)
 */
export function routeOutboxMessage(
  message: RelayedMessage,
): JobRequest | undefined {
  const type = OutboxMessageType.safeParse(message.type);
  if (!type.success) {
    return undefined;
  }
  const messageType: OutboxMessageType = type.data;
  switch (messageType) {
    case "stream.check_requested": {
      const payload = StreamCheckRequestedPayload.parse(message.payload);
      return {
        queue: STREAM_CHECKS_QUEUE,
        name: STREAM_CHECK_JOBS.check,
        data: { eventId: payload.eventId, slot: payload.requestedAt },
        jobId: `outbox-${message.id}`,
      };
    }
    case "demo.events_deleted":
      // Legacy: left by an earlier build; its job records the prefixes.
      return {
        queue: MAINTENANCE_QUEUE,
        name: MAINTENANCE_JOBS.legacyDemoPurgeFiles,
        data: DemoEventsDeletedPayload.parse(message.payload),
        jobId: `outbox-${message.id}`,
      };
    case "event.transitioned":
    case "attendee.verified":
      // The fan-out reads the message itself, and decides whether any
      // endpoint wants it.
      return {
        queue: WEBHOOKS_QUEUE,
        name: WEBHOOK_JOBS.fanOut,
        data: { outboxMessageId: message.id },
        jobId: `outbox-${message.id}`,
      };
    case "triage.requested":
      return {
        queue: TRIAGE_QUEUE,
        name: TRIAGE_JOBS.run,
        data: TriageRequestedPayload.parse(message.payload),
        jobId: `outbox-${message.id}`,
      };
    default:
      return messageType satisfies never;
  }
}
