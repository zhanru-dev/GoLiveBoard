import {
  DemoEventsDeletedPayload,
  OutboxMessageType,
  StreamCheckRequestedPayload,
} from "@opspilot/contracts";

import { UPLOAD_URL_TTL_SECONDS } from "../assets/assets.service.js";
import type { JobRequest } from "../queues/job-publisher.js";
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  STREAM_CHECK_JOBS,
  STREAM_CHECKS_QUEUE,
} from "../queues/queues.js";

/**
 * The files of events a demo reset deleted are deleted again once every
 * upload link handed out before the reset has expired, so a slow upload
 * cannot leave a file behind (the milestone 4 review). Storage may be down
 * then: the job keeps retrying for hours.
 */
export const DEMO_PURGE_JOB_OPTIONS = {
  delay: UPLOAD_URL_TTL_SECONDS * 1000 + 5 * 60 * 1000,
  attempts: 10,
  backoff: { type: "exponential", delay: 30_000 },
} as const;

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
    case "demo.events_deleted":
      return {
        queue: MAINTENANCE_QUEUE,
        name: MAINTENANCE_JOBS.demoPurgeFiles,
        data: DemoEventsDeletedPayload.parse(message.payload),
        jobId: `outbox-${message.id}`,
        options: DEMO_PURGE_JOB_OPTIONS,
      };
    case "event.transitioned":
      return undefined;
    default:
      return messageType satisfies never;
  }
}
