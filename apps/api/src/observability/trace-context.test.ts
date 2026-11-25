import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSpans, type CapturedSpans } from "../testing/spans.js";
import { currentTraceCarrier, inTraceOf } from "./trace-context.js";

const traceIdNow = () => trace.getActiveSpan()?.spanContext().traceId;

describe("trace carriers (outbox messages, ADR-0011)", () => {
  let captured: CapturedSpans;

  beforeAll(() => {
    captured = captureSpans();
  });

  afterAll(async () => {
    await captured.stop();
  });

  it("carries nothing outside a trace, and the trace's traceparent inside one", () => {
    expect(currentTraceCarrier()).toBeNull();

    const tracer = trace.getTracer("test");
    const [carrier, traceId] = tracer.startActiveSpan("request", (span) => {
      const result = [currentTraceCarrier(), span.spanContext().traceId];
      span.end();
      return result as [Record<string, string> | null, string];
    });

    expect(carrier?.traceparent).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    );
  });

  it("runs work in the carrier's trace, and in none for anything else, whatever is active", () => {
    const carrier = {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    };
    const tracer = trace.getTracer("test");

    const [joined, unrelated, garbage] = tracer.startActiveSpan(
      "elsewhere",
      (span) => {
        const result = [
          inTraceOf(carrier, traceIdNow),
          inTraceOf(null, traceIdNow),
          inTraceOf(["not", "a", "carrier"], traceIdNow),
        ];
        span.end();
        return result;
      },
    );

    expect(joined).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(unrelated).toBeUndefined();
    expect(garbage).toBeUndefined();
  });
});
