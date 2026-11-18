import { type Meter, metrics } from "@opentelemetry/api";

/**
 * The application's own metrics (docs/06, section 7); request rate, errors
 * and duration per route come from the HTTP instrumentation.
 */
export const METRICS = {
  /** Jobs per queue and state (wait, delayed, active, failed). */
  queueJobs: "opspilot.queue.jobs",
  /** Age of the oldest job waiting in each queue, in seconds. */
  queueOldestJobAge: "opspilot.queue.oldest_job_age",
  /** Age of the oldest outbox message not yet relayed, in seconds. */
  outboxOldestMessageAge: "opspilot.outbox.oldest_message_age",
  /** Real-time connections open on this API instance. */
  realtimeConnections: "opspilot.realtime.connections",
  /** Stream checks, by whether the stream played. */
  streamChecks: "opspilot.stream.checks",
  /** Webhook delivery attempts, per endpoint and outcome. */
  webhookAttempts: "opspilot.webhook.attempts",
} as const;

/**
 * The application's meter. Take it when a provider is constructed or a
 * value is recorded, never when a module loads: a meter taken before the
 * SDK starts never records.
 */
export function appMeter(): Meter {
  return metrics.getMeter("opspilot");
}

/** Counts a webhook delivery attempt (alert: one endpoint failing). */
export function countWebhookAttempt(
  endpointId: string,
  delivered: boolean,
): void {
  appMeter()
    .createCounter(METRICS.webhookAttempts, {
      description: "Webhook delivery attempts",
    })
    .add(1, {
      "opspilot.webhook.endpoint_id": endpointId,
      "opspilot.webhook.delivered": delivered,
    });
}

/** Counts a stream check (the stream-check failures on the dashboard). */
export function countStreamCheck(eventId: string, healthy: boolean): void {
  appMeter()
    .createCounter(METRICS.streamChecks, {
      description: "Stream checks, by whether the stream played",
    })
    .add(1, {
      "opspilot.event_id": eventId,
      "opspilot.stream.healthy": healthy,
    });
}
