import {
  defaultTextMapGetter,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  type ReadableSpan,
  SamplingDecision,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";

import {
  RedactingExporter,
  redactAttributes,
  telemetryEndpoint,
  tracePolicy,
} from "./server-telemetry";

describe("tracePolicy", () => {
  it("takes the parent from a visitor's traceparent, but records the request whatever it asks and reads no baggage", () => {
    const { sampler, textMapPropagator } = tracePolicy();
    const visitorTrace = "0af7651916cd43dd8448eb211c80319c";
    const parent = textMapPropagator.extract(
      ROOT_CONTEXT,
      {
        // "Do not record this", with data to pass on.
        traceparent: `00-${visitorTrace}-b7ad6b7169203331-00`,
        baggage: "injected=from-the-browser",
      },
      defaultTextMapGetter,
    );

    expect(trace.getSpanContext(parent)).toMatchObject({
      traceId: visitorTrace,
      traceFlags: TraceFlags.NONE,
    });
    expect(
      sampler.shouldSample(
        parent,
        visitorTrace,
        "GET /",
        SpanKind.SERVER,
        {},
        [],
      ).decision,
    ).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(propagation.getBaggage(parent)).toBeUndefined();
  });
});

describe("telemetryEndpoint", () => {
  it("is off without an endpoint, and refuses one that is not http(s)", () => {
    expect(telemetryEndpoint({})).toBeUndefined();
    expect(
      telemetryEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: " " }),
    ).toBeUndefined();
    expect(
      telemetryEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318/" }),
    ).toBe("http://lgtm:4318");
    expect(() =>
      telemetryEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "lgtm:4318" }),
    ).toThrow(/http\(s\) URL/);
  });
});

describe("redactAttributes (web server)", () => {
  it("drops query strings and the visitor's address, like the API", () => {
    expect(
      redactAttributes({
        "http.target": "/verify?token=secret",
        "url.full": "https://x.test/verify?token=secret",
        "url.query": "token=secret",
        "client.address": "203.0.113.7",
        "next.route": "/verify",
      }),
    ).toEqual({
      "http.target": "/verify",
      "url.full": "https://x.test/verify",
      "next.route": "/verify",
    });
  });

  it("exports spans redacted, and reports a failure when the next exporter throws", () => {
    const span = {
      name: "fetch GET http://internal-api.test/api/v1/verify?token=secret",
      attributes: { "url.query": "token=secret" },
    } as unknown as ReadableSpan;
    let seen: ReadableSpan[] = [];
    const results: ExportResult[] = [];
    const working: SpanExporter = {
      export(spans, done) {
        seen = spans;
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    const broken: SpanExporter = {
      export() {
        throw new Error("down");
      },
      shutdown: () => Promise.resolve(),
    };

    new RedactingExporter(working).export([span], (result) =>
      results.push(result),
    );
    new RedactingExporter(broken).export([span], (result) =>
      results.push(result),
    );

    expect(seen[0]?.attributes).toEqual({});
    expect(seen[0]?.name).toBe(
      "fetch GET http://internal-api.test/api/v1/verify",
    );
    expect(results.map(({ code }) => code)).toEqual([
      ExportResultCode.SUCCESS,
      ExportResultCode.FAILED,
    ]);
  });
});
