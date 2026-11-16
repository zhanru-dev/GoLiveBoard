import { describe, expect, it } from "vitest";

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

  it("turns a message left by an earlier build into the job that records its purges", () => {
    expect(
      routeOutboxMessage({
        id,
        type: "demo.events_deleted",
        payload: { eventIds: [eventId] },
      }),
    ).toEqual({
      queue: "maintenance",
      name: "demo-purge-files",
      data: { eventIds: [eventId] },
      jobId: `outbox-${id}`,
    });
  });

  it.each(["event.transitioned", "attendee.verified"])(
    "turns %s into a webhook fan-out keyed by the message",
    (type) => {
      expect(routeOutboxMessage({ id, type, payload: {} })).toEqual({
        queue: "webhooks",
        name: "fan-out",
        data: { outboxMessageId: id },
        jobId: `outbox-${id}`,
      });
    },
  );

  it("routes an unknown type nowhere", () => {
    expect(
      routeOutboxMessage({ id, type: "something.else", payload: {} }),
    ).toBeUndefined();
  });

  it("refuses a malformed payload", () => {
    expect(() =>
      routeOutboxMessage({ id, type: "stream.check_requested", payload: {} }),
    ).toThrow();
  });
});
