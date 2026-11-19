import type { Attributes, TextMapPropagator } from "@opentelemetry/api";
import {
  ExportResultCode,
  type ExportResult,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  ExpressInstrumentation,
  ExpressLayerType,
} from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  type ReadableSpan,
  type Sampler,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { API_PREFIX } from "../http/api-prefix.js";

/** What this process's telemetry needs to know, read from the environment. */
export interface TelemetrySettings {
  /** The OTLP/HTTP endpoint (a collector); telemetry is off without one. */
  readonly endpoint: string | undefined;
  readonly serviceName: string;
  readonly release: string;
  readonly environment: string;
  /** How often metrics are sent. */
  readonly metricIntervalMs: number;
}

/** The two processes built from this package. */
export type TelemetryProcess = "api" | "worker";

/**
 * Settings from the standard OpenTelemetry variables, with the release and
 * environment Sentry also uses (docs/06, section 7).
 */
export function telemetrySettings(
  env: NodeJS.ProcessEnv,
  process: TelemetryProcess,
): TelemetrySettings {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint !== undefined && endpoint !== "") {
    // Fail at start rather than drop every span quietly.
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL, not ${url.protocol}`,
      );
    }
  }
  return {
    endpoint: endpoint === "" ? undefined : endpoint,
    serviceName: env.OTEL_SERVICE_NAME ?? `opspilot-${process}`,
    release: env.SENTRY_RELEASE ?? "development",
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    metricIntervalMs: metricInterval(env.OTEL_METRIC_EXPORT_INTERVAL),
  };
}

/** Every 15 seconds unless set (the standard variable, in milliseconds). */
function metricInterval(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 100
    ? parsed
    : 15_000;
}

/** Attributes whose values may carry a query string (one-time tokens). */
const URL_ATTRIBUTES = ["url.full", "http.url", "http.target", "url.original"];
/** Attributes that identify a person: the visitor's address. */
const DROPPED_ATTRIBUTES = ["url.query", "client.address", "http.client_ip"];

/**
 * A span's attributes as they may leave the process (NFR-2): no query
 * strings, which carry one-time tokens in verification links, and no
 * visitor addresses. Headers and bodies are never recorded.
 */
export function redactAttributes(attributes: Attributes): Attributes {
  const redacted: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (DROPPED_ATTRIBUTES.includes(key)) {
      continue;
    }
    redacted[key] =
      URL_ATTRIBUTES.includes(key) && typeof value === "string"
        ? value.split("?", 1)[0]
        : value;
  }
  return redacted;
}

/** Hands spans on with their attributes redacted. */
export class RedactingExporter implements SpanExporter {
  constructor(private readonly next: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      this.next.export(
        spans.map(
          (span): ReadableSpan =>
            // The span itself, with its attributes redacted.
            // The span itself, with its name and attributes redacted
            // (Next.js names fetch spans after the whole URL).
            Object.create(span, {
              name: { value: span.name.split("?", 1)[0] },
              attributes: { value: redactAttributes(span.attributes) },
            }) as ReadableSpan,
        ),
        resultCallback,
      );
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush?.() ?? Promise.resolve();
  }
}

const HEALTH_PATH = `/${API_PREFIX}/health/`;

/**
 * What is traced automatically: HTTP in and out (health checks aside, which
 * a load balancer calls every few seconds), Express routes, PostgreSQL
 * queries (their text, never their values) and Valkey commands (their name,
 * never their arguments, which hold keys made of addresses and tokens).
 *
 * Outgoing calls and queries are traced only inside a request or a job: the
 * pollers that run every second would otherwise start a trace each time.
 * NestJS's own instrumentation does not support NestJS 12; Express names
 * the route.
 */
export function instrumentations() {
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) =>
        request.url?.startsWith(HEALTH_PATH) ?? false,
      requireParentforOutgoingSpans: true,
    }),
    new UndiciInstrumentation({ requireParentforSpans: true }),
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
    }),
    new PgInstrumentation({
      requireParentSpan: true,
      enhancedDatabaseReporting: false,
    }),
    new IORedisInstrumentation({
      requireParentSpan: true,
      dbStatementSerializer: (command) => command,
    }),
  ];
}

/**
 * How a request's own W3C trace headers are taken. A visitor can send them
 * (the browser does, with its API calls). They name the parent, nothing
 * more: every request is recorded whatever its sampled flag says, so a
 * visitor cannot hide their requests from the traces, and no baggage is
 * read or passed on, so a visitor cannot put data into the outbox or into
 * the headers of outgoing calls.
 */
export function tracePolicy(): {
  sampler: Sampler;
  textMapPropagator: TextMapPropagator;
} {
  return {
    sampler: new AlwaysOnSampler(),
    textMapPropagator: new W3CTraceContextPropagator(),
  };
}

let running: NodeSDK | undefined;

/**
 * Starts tracing for this process (ADR-0011) when an endpoint is set. It
 * must run before the application's modules load, so their libraries are
 * instrumented: `node --import ./dist/telemetry.js`.
 *
 * @returns whether tracing is on
 */
export function startTelemetry(settings: TelemetrySettings): boolean {
  if (settings.endpoint === undefined || running !== undefined) {
    return running !== undefined;
  }
  const base = settings.endpoint.replace(/\/+$/, "");
  running = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: settings.serviceName,
      [ATTR_SERVICE_VERSION]: settings.release,
      "deployment.environment.name": settings.environment,
    }),
    traceExporter: new RedactingExporter(
      new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    ),
    ...tracePolicy(),

    // Request rate, errors and duration per route come from the HTTP
    // instrumentation (http.server.request.duration); the application's
    // own are in metrics.ts (docs/06, section 7).
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: settings.metricIntervalMs,
      }),
    ],
    instrumentations: instrumentations(),
  });
  running.start();
  return true;
}

/**
 * How long stopping may take. The exporters' own timeout is 10 seconds,
 * Docker's grace period too: an unreachable collector would hold the stop
 * until the process is killed, losing the error reports sent after it.
 */
export const TELEMETRY_STOP_MS = 2_000;

/**
 * Sends the spans and metrics still queued; called as the process stops.
 * Gives up after `timeoutMs`: telemetry is not worth a stop that hangs.
 *
 * @returns whether everything was sent in time
 */
export async function stopTelemetry(
  timeoutMs: number = TELEMETRY_STOP_MS,
): Promise<boolean> {
  const sdk = running;
  running = undefined;
  if (sdk === undefined) {
    return true;
  }
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      sdk.shutdown().then(
        () => true,
        () => false,
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
