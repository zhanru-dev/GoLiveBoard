import { SpanStatusCode, trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureSpans, type CapturedSpans } from "../testing/spans.js";
import { describeSpan, inSpan } from "./spans.js";

describe("inSpan", () => {
  let captured: CapturedSpans;

  beforeAll(() => {
    captured = captureSpans();
  });

  afterAll(async () => {
    await captured.stop();
  });

  it("runs work in a span of its own, which describeSpan adds to", async () => {
    const result = await inSpan("thing.do", { "opspilot.id": "1" }, () => {
      describeSpan({ "opspilot.count": 3 });
      return Promise.resolve(
        trace.getActiveSpan()?.spanContext().spanId ?? "none",
      );
    });

    const span = captured.spans().find(({ name }) => name === "thing.do");
    expect(span?.attributes).toEqual({
      "opspilot.id": "1",
      "opspilot.count": 3,
    });
    expect(result).toBe(span?.spanContext().spanId);
    expect(span?.ended).toBe(true);
  });

  it("marks a failure with the error's type, never its message, and rethrows it", async () => {
    await expect(
      inSpan("thing.fail", {}, () =>
        Promise.reject(new TypeError("for ada@example.com")),
      ),
    ).rejects.toThrow("for ada@example.com");

    const span = captured.spans().find(({ name }) => name === "thing.fail");
    expect(span?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "TypeError",
    });
    expect(span?.events).toEqual([]);
  });
});
