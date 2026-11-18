import { describe, expect, it, vi } from "vitest";

import { traceparent } from "./traceparent";

describe("traceparent", () => {
  it("starts a new sampled W3C trace each time", () => {
    const first = traceparent();
    const second = traceparent();

    expect(first).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(second).not.toBe(first);
  });

  it("never sends an all-zero trace or span ID, which the API would ignore", () => {
    const random = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((array) => array);

    try {
      const [, traceId, spanId] = traceparent().split("-");

      expect(traceId).toBe(`${"0".repeat(31)}1`);
      expect(spanId).toBe(`${"0".repeat(15)}1`);
    } finally {
      random.mockRestore();
    }
  });
});
