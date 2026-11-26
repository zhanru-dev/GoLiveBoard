import type { Attributes, TextMapPropagator } from "@opentelemetry/api";
import {
  ExportResultCode,
  type ExportResult,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK, type NodeSDKConfiguration } from "@opentelemetry/sdk-node";
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

/** Attributes whose values may carry a query string (one-time tokens). */
const URL_ATTRIBUTES = ["url.full", "http.url", "http.target", "url.original"];
/** Attributes that identify a person: the visitor's address. */
const DROPPED_ATTRIBUTES = ["url.query", "client.address", "http.client_ip"];

/**
 * A span's attributes as they may leave the web server (NFR-2): no query
 * strings, which carry one-time tokens in verification links, and no
 * visitor addresses. The same rule as the API's
 * (apps/api/src/observability/telemetry.ts).
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

/** The OTLP/HTTP endpoint traces go to, or undefined when tracing is off. */
export function telemetryEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint === "") {
    return undefined;
  }
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL, not ${url.protocol}`,
    );
  }
  return endpoint.replace(/\/+$/, "");
}

/**
 * How a request's own W3C trace headers are taken. A visitor can send them
 * (the browser does, with its API calls). They name the parent, nothing
 * more: every request is recorded whatever its sampled flag says, so a
 * visitor cannot hide their requests from the traces, and no baggage is
 * read or passed on to the API.
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

/** What the web server's OpenTelemetry SDK is started with. */
export function serverSdkOptions(
  endpoint: string,
  env: Readonly<Record<string, string | undefined>>,
): Partial<NodeSDKConfiguration> {
  return {
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? "goliveboard-web",
      [ATTR_SERVICE_VERSION]: env.SENTRY_RELEASE ?? "development",
      "deployment.environment.name":
        env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    }),
    traceExporter: new RedactingExporter(
      new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    ),
    ...tracePolicy(),
    instrumentations: [new UndiciInstrumentation()],
  };
}

/**
 * Starts tracing in the web server (ADR-0011) when an endpoint is set.
 * Next.js records its own spans for pages and route handlers once a tracer
 * provider is registered; Node's fetch (undici) is traced here, which also
 * puts the trace on the web server's calls to the API.
 *
 * @returns whether tracing is on
 */
export function startServerTelemetry(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const endpoint = telemetryEndpoint(env);
  if (endpoint === undefined || running !== undefined) {
    return running !== undefined;
  }
  running = new NodeSDK(serverSdkOptions(endpoint, env));
  running.start();
  // Send what is queued as the container stops.
  process.once("SIGTERM", () => {
    void running?.shutdown();
  });
  return true;
}
