import { type Meter, metrics } from "@opentelemetry/api";

/**
 * The application's own metrics (docs/06, section 7); request rate, errors
 * and duration per route come from the HTTP instrumentation.
 */
export const METRICS = {
  /** Jobs per queue and state (wait, delayed, active, failed). */
  queueJobs: "goliveboard.queue.jobs",
  /** Age of the oldest job waiting in each queue, in seconds. */
  queueOldestJobAge: "goliveboard.queue.oldest_job_age",
  /** Age of the oldest outbox message not yet relayed, in seconds. */
  outboxOldestMessageAge: "goliveboard.outbox.oldest_message_age",
  /** Real-time connections open on this API instance. */
  realtimeConnections: "goliveboard.realtime.connections",
  /** Stream checks, by whether the stream played. */
  streamChecks: "goliveboard.stream.checks",
  /** Webhook delivery attempts, per endpoint and outcome. */
  webhookAttempts: "goliveboard.webhook.attempts",
  /** LCP and INP measured in visitors' browsers, in ms (NFR-3, at p75). */
  webVitalDuration: "goliveboard.web.vital_duration",
  /** CLS measured in visitors' browsers. */
  webLayoutShift: "goliveboard.web.layout_shift",
  /** Real-time connections browsers could not make, or lost. */
  webRealtimeFailures: "goliveboard.web.realtime_failures",
} as const;

/**
 * The application's meter. Take it when a provider is constructed or a
 * value is recorded, never when a module loads: a meter taken before the
 * SDK starts never records.
 */
export function appMeter(): Meter {
  return metrics.getMeter("goliveboard");
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
      "goliveboard.webhook.endpoint_id": endpointId,
      "goliveboard.webhook.delivered": delivered,
    });
}

/**
 * Records a Core Web Vital from a visitor's browser (browser-telemetry).
 * Labels are the vital and the route template only: both from fixed lists.
 */
export function recordWebVital(
  name: "LCP" | "INP" | "CLS",
  value: number,
  route: string,
): void {
  const meter = appMeter();
  const attributes = {
    "goliveboard.web.vital": name,
    "goliveboard.web.route": route,
  };
  if (name === "CLS") {
    meter
      .createHistogram(METRICS.webLayoutShift, {
        description: "Cumulative Layout Shift in visitors' browsers",
        advice: {
          explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
        },
      })
      .record(value, attributes);
    return;
  }
  meter
    .createHistogram(METRICS.webVitalDuration, {
      description: "LCP and INP in visitors' browsers",
      unit: "ms",
      // Fine around NFR-3's lines (200 ms for INP, 2.5 s for LCP), so the
      // 75th percentile is read close to where it matters.
      advice: {
        explicitBucketBoundaries: [
          50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000,
          6000, 10000,
        ],
      },
    })
    .record(value, attributes);
}

/** Counts a real-time connection a browser could not make, or lost. */
export function countRealtimeFailure(reason: string, route: string): void {
  appMeter()
    .createCounter(METRICS.webRealtimeFailures, {
      description: "Real-time connections browsers could not make, or lost",
    })
    .add(1, {
      "goliveboard.web.realtime_failure": reason,
      "goliveboard.web.route": route,
    });
}

/** Counts a stream check (the stream-check failures on the dashboard). */
export function countStreamCheck(eventId: string, healthy: boolean): void {
  appMeter()
    .createCounter(METRICS.streamChecks, {
      description: "Stream checks, by whether the stream played",
    })
    .add(1, {
      "goliveboard.event_id": eventId,
      "goliveboard.stream.healthy": healthy,
    });
}
