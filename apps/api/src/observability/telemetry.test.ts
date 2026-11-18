import {
  context,
  ROOT_CONTEXT,
  type SpanContext,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { traceFields } from "./logger.js";
import {
  RedactingExporter,
  redactAttributes,
  telemetrySettings,
} from "./telemetry.js";

describe("telemetrySettings", () => {
  it("is off without an endpoint, and names each process", () => {
    expect(telemetrySettings({}, "api")).toEqual({
      endpoint: undefined,
      serviceName: "opspilot-api",
      release: "development",
      environment: "development",
      metricIntervalMs: 15_000,
    });
    expect(
      telemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: " " }, "worker"),
    ).toMatchObject({ endpoint: undefined, serviceName: "opspilot-worker" });
  });

  it("tags spans with the release and environment Sentry uses", () => {
    expect(
      telemetrySettings(
        {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
          SENTRY_RELEASE: "abc123",
          SENTRY_ENVIRONMENT: "demo",
        },
        "api",
      ),
    ).toEqual({
      endpoint: "http://collector:4318",
      serviceName: "opspilot-api",
      release: "abc123",
      environment: "demo",
      metricIntervalMs: 15_000,
    });
  });

  it("refuses an endpoint that is not an http(s) URL, at start", () => {
    expect(() =>
      telemetrySettings(
        { OTEL_EXPORTER_OTLP_ENDPOINT: "collector:4318" },
        "api",
      ),
    ).toThrow(/http\(s\) URL/);
    expect(() =>
      telemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" }, "api"),
    ).toThrow();
  });
});

describe("the metric interval", () => {
  it("is 15 seconds unless OTEL_METRIC_EXPORT_INTERVAL sets a sensible one", () => {
    const interval = (value?: string) =>
      telemetrySettings({ OTEL_METRIC_EXPORT_INTERVAL: value }, "api")
        .metricIntervalMs;

    expect(interval()).toBe(15_000);
    expect(interval("1000")).toBe(1_000);
    expect(interval("10")).toBe(15_000);
    expect(interval("soon")).toBe(15_000);
  });
});

describe("redactAttributes", () => {
  it("drops query strings and the visitor's address, and keeps the rest", () => {
    expect(
      redactAttributes({
        "url.full": "https://x.test/verify?token=secret#top",
        "http.url": "https://x.test/a?b=c",
        "http.target": "/api/v1/verify?token=secret",
        "url.original": "/x?y=z",
        "url.query": "token=secret",
        "client.address": "203.0.113.7",
        "http.client_ip": "203.0.113.7",
        "url.path": "/api/v1/verify",
        "http.response.status_code": 200,
      }),
    ).toEqual({
      "url.full": "https://x.test/verify",
      "http.url": "https://x.test/a",
      "http.target": "/api/v1/verify",
      "url.original": "/x",
      "url.path": "/api/v1/verify",
      "http.response.status_code": 200,
    });
  });
});

describe("RedactingExporter", () => {
  const span = {
    name: "GET /verify",
    attributes: { "url.query": "token=secret", "url.path": "/verify" },
  } as unknown as ReadableSpan;

  it("hands on each span with its attributes redacted, the rest as it was", () => {
    let seen: ReadableSpan[] = [];
    const next: SpanExporter = {
      export(spans, done) {
        seen = spans;
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    let result: ExportResult | undefined;

    new RedactingExporter(next).export([span], (outcome) => {
      result = outcome;
    });

    expect(result?.code).toBe(ExportResultCode.SUCCESS);
    expect(seen[0]?.attributes).toEqual({ "url.path": "/verify" });
    expect(seen[0]?.name).toBe("GET /verify");
    // The original is untouched.
    expect(span.attributes).toHaveProperty("url.query");
  });

  it("reports a failure when the next exporter throws", () => {
    const next: SpanExporter = {
      export() {
        throw new Error("down");
      },
      shutdown: () => Promise.resolve(),
    };
    let result: ExportResult | undefined;

    new RedactingExporter(next).export([span], (outcome) => {
      result = outcome;
    });

    expect(result?.code).toBe(ExportResultCode.FAILED);
  });
});

describe("traceFields", () => {
  const manager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(manager.enable());
  });

  afterAll(() => {
    context.disable();
  });

  it("adds the active trace to a log line, and nothing outside one", () => {
    const spanContext: SpanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    };
    const inside = context.with(
      trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(spanContext)),
      traceFields,
    );

    expect(inside).toEqual({
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
    });
    expect(traceFields()).toEqual({});
  });
});
