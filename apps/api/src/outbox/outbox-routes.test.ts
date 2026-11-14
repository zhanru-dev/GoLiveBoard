import { describe, expect, it } from "vitest";

import { UPLOAD_URL_TTL_SECONDS } from "../assets/assets.service.js";
import { routeOutboxMessage } from "./outbox-routes.js";

const id = "0193f2a4-7c1e-7b2a-9d1f-3e5c7a9b1d2f";
const eventId = "0193f2a4-0000-7b2a-9d1f-3e5c7a9b1d2f";

describe("routeOutboxMessage", () => {
  it("turns a check request into a check job keyed by the message", () => {
    expect(
      routeOutboxMessage({
        id,
        type: "stream.check_requested",
        payload: { eventId, requestedAt: "2026-12-01T17:00:00.000Z" },
      }),
    ).toEqual({
      queue: "stream-checks",
      name: "check",
      data: { eventId, slot: "2026-12-01T17:00:00.000Z" },
      jobId: `outbox-${id}`,
    });
  });

  it("purges a demo reset's files only after every upload link it could have missed has expired", () => {
    const job = routeOutboxMessage({
      id,
      type: "demo.events_deleted",
      payload: { eventIds: [eventId] },
    });

    expect(job).toMatchObject({
      queue: "maintenance",
      name: "demo-purge-files",
      data: { eventIds: [eventId] },
      jobId: `outbox-${id}`,
    });
    expect(job?.options?.delay).toBeGreaterThan(UPLOAD_URL_TTL_SECONDS * 1000);
    // Storage may be down for a while: retried for hours, not seconds.
    expect(job?.options?.attempts).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ["a type nothing consumes yet", "event.transitioned"],
    ["an unknown type", "something.else"],
  ])("routes %s nowhere", (_label, type) => {
    expect(routeOutboxMessage({ id, type, payload: {} })).toBeUndefined();
  });

  it("refuses a malformed payload", () => {
    expect(() =>
      routeOutboxMessage({ id, type: "stream.check_requested", payload: {} }),
    ).toThrow();
  });
});
