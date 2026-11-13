import {
  OutboxMessageType,
  StreamCheckRequestedPayload,
} from "@opspilot/contracts";

import type { JobRequest } from "../queues/job-publisher.js";
import { STREAM_CHECK_JOBS, STREAM_CHECKS_QUEUE } from "../queues/queues.js";

export interface RelayedMessage {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * The job an outbox message becomes, or `undefined` when nothing consumes
 * that type yet (`event.transitioned` gets its webhook job in milestone 7).
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
    case "event.transitioned":
      return undefined;
    default:
      return messageType satisfies never;
  }
}
