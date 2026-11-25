import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForValkey } from "./valkey.js";

/** A client that connects when the test says so. */
function fakeClient(status = "connecting") {
  const client = Object.assign(new EventEmitter(), { status });
  const connect = () => {
    client.status = "ready";
    client.emit("ready");
  };
  return { client, connect };
}

describe("waitForValkey", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves at once when the client is already connected", async () => {
    const { client } = fakeClient("ready");

    await expect(waitForValkey(client as never, 1_000)).resolves.toBe(true);
  });

  it("resolves when the client connects", async () => {
    const { client, connect } = fakeClient();
    const waiting = waitForValkey(client as never, 1_000);

    connect();

    await expect(waiting).resolves.toBe(true);
  });

  it("gives up after the timeout, and stops listening", async () => {
    vi.useFakeTimers();
    const { client } = fakeClient();
    const waiting = waitForValkey(client as never, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toBe(false);
    expect(client.listenerCount("ready")).toBe(0);
  });
});
