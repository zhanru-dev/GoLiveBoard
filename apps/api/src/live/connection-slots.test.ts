import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";

import { loadTestConfig } from "../testing/config.js";
import { ConnectionSlots } from "./connection-slots.js";

/** A client whose whole pipeline fails, as when its connection drops mid-way. */
function failingClient(): Redis {
  const pipeline = {
    eval() {
      return pipeline;
    },
    exec: () => Promise.reject(new Error("Connection is closed.")),
  };
  return { pipeline: () => pipeline } as unknown as Redis;
}

describe("ConnectionSlots.refresh", () => {
  it("names no connection as lost when the whole refresh fails", async () => {
    const slots = new ConnectionSlots(failingClient(), loadTestConfig());

    await expect(
      slots.refresh(
        [
          ["session:a", "one"],
          ["session:a", "two"],
        ],
        10,
      ),
    ).resolves.toEqual([]);
  });
});
