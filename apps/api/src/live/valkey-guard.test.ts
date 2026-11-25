import { describe, expect, it, vi } from "vitest";

import { catchRejections } from "./valkey-guard.js";

class FakeClient {
  calls: unknown[][] = [];

  subscribe(...channels: string[]): Promise<number> {
    this.calls.push(channels);
    return Promise.reject(new Error("Connection is closed."));
  }

  publish(channel: string): Promise<number> {
    this.calls.push([channel]);
    return Promise.resolve(2);
  }
}

describe("catchRejections", () => {
  it("turns a failed command into a reported one, not an unhandled rejection", async () => {
    const onError = vi.fn();
    const client = catchRejections(new FakeClient(), ["subscribe"], onError);

    // Not awaited, as the adapter does: nothing may escape.
    const result = client.subscribe("a", "b");

    await expect(result).resolves.toBeUndefined();
    expect(client.calls).toEqual([["a", "b"]]);
    expect(onError).toHaveBeenCalledWith("subscribe", expect.any(Error));
  });

  it("leaves successful commands and other methods alone", async () => {
    const onError = vi.fn();
    const client = catchRejections(new FakeClient(), ["publish"], onError);

    await expect(client.publish("x")).resolves.toBe(2);
    await expect(client.subscribe("y")).rejects.toThrow("closed");
    expect(onError).not.toHaveBeenCalled();
  });
});
