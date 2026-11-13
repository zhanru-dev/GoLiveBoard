import type { ConnectionOptions, DefaultJobOptions } from "bullmq";

import type { AppConfig } from "../config/app-config.js";

/** Checks of event streams: scheduled every 30 seconds, or requested. */
export const STREAM_CHECKS_QUEUE = "stream-checks";

export const STREAM_CHECK_JOBS = {
  /** Checks one event's stream for one slot (CheckStreamJob). */
  check: "check",
  /** Repeats every 30 seconds and enqueues a check per due event. */
  schedule: "schedule",
} as const;

/** Every queue the worker consumes. */
export const QUEUE_NAMES = [STREAM_CHECKS_QUEUE] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * BullMQ blocks on Valkey while it waits for jobs, so its connections must
 * retry commands forever (`maxRetriesPerRequest: null`) instead of failing
 * them like the request-path client does.
 */
export function queueConnection(config: AppConfig): ConnectionOptions {
  return {
    url: config.valkey.url,
    maxRetriesPerRequest: null,
    connectionName: "opspilot-worker",
  };
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Failed jobs retry with exponential backoff (1 s, 2 s, 4 s). Finished jobs
 * are kept for a day: while a job is kept, adding another with the same ID
 * does nothing, which is what makes re-relayed outbox messages harmless.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: DAY_SECONDS },
  removeOnFail: { age: 7 * DAY_SECONDS },
};
