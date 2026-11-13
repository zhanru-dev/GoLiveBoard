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

/** A queue command that has not answered by then fails (relay, scheduler). */
export const QUEUE_COMMAND_TIMEOUT_MS = 2_000;
/** How long shutdown waits for a queue or worker to close cleanly. */
export const SHUTDOWN_GRACE_MS = 3_000;

/**
 * For adding jobs. A frozen Valkey must not hold the outbox relay forever:
 * its round would never end and the worker could never shut down (the
 * milestone 3 review). A command that times out fails the relay's round,
 * which rolls back, so its messages stay in the outbox and are retried.
 *
 * A command timeout alone only fails the caller: the command stays queued
 * for a reply that a frozen server never sends, so every retry adds one
 * more (the milestone 3 re-review). The socket timeout drops a connection
 * that has gone silent with commands outstanding, which fails them all and
 * reconnects, so what is queued stays bounded while Valkey is frozen.
 */
export function producerConnection(config: AppConfig): ConnectionOptions {
  return {
    url: config.valkey.url,
    connectionName: "opspilot-producer",
    maxRetriesPerRequest: 1,
    commandTimeout: QUEUE_COMMAND_TIMEOUT_MS,
    socketTimeout: QUEUE_COMMAND_TIMEOUT_MS,
  };
}

/**
 * For consuming jobs. BullMQ blocks on Valkey while it waits for jobs, so
 * this connection must retry forever (`maxRetriesPerRequest: null`) and has
 * no command timeout; shutdown bounds it instead (closeWithin).
 */
export function consumerConnection(config: AppConfig): ConnectionOptions {
  return {
    url: config.valkey.url,
    maxRetriesPerRequest: null,
    connectionName: "opspilot-consumer",
  };
}

/**
 * Closes cleanly if that finishes within the grace period, otherwise forces
 * the connection shut, so a frozen Valkey cannot keep the process alive.
 *
 * @returns whether the clean close finished in time
 */
export async function closeWithin(
  close: () => Promise<void>,
  forceClose: () => Promise<void>,
  graceMs: number = SHUTDOWN_GRACE_MS,
): Promise<boolean> {
  const expired = (milliseconds: number) =>
    new Promise<"expired">((resolve) =>
      setTimeout(() => {
        resolve("expired");
      }, milliseconds).unref(),
    );
  const outcome = await Promise.race([
    close().then(
      () => "closed" as const,
      () => "closed" as const,
    ),
    expired(graceMs),
  ]);
  if (outcome === "closed") {
    return true;
  }
  await Promise.race([forceClose().catch(() => undefined), expired(graceMs)]);
  return false;
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
