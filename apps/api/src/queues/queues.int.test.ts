import { randomBytes } from "node:crypto";

import type { StartedValkeyContainer } from "@testcontainers/valkey";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config/app-config.js";
import { pauseContainer, startValkey } from "../testing/containers.js";
import { producerConnection } from "./queues.js";

/** What ioredis keeps for commands that have not been answered yet. */
interface PendingCommands {
  readonly commandQueue: { readonly length: number };
  readonly offlineQueue: { readonly length: number };
}

const PUBLISH_ATTEMPTS = 12;

describe("producer connection while Valkey is frozen", () => {
  let valkey: StartedValkeyContainer;

  beforeAll(async () => {
    valkey = await startValkey();
  });

  afterAll(async () => {
    await valkey.stop();
  });

  it(
    "does not pile up unanswered commands, and recovers once Valkey answers",
    { timeout: 60_000 },
    async () => {
      const config = {
        valkey: { url: valkey.getConnectionUrl() },
      } as AppConfig;
      const queue = new Queue("frozen", {
        connection: producerConnection(config),
        prefix: `test-${randomBytes(4).toString("hex")}`,
      });
      // ioredis reports dropped sockets as errors; they are expected here.
      queue.on("error", () => undefined);
      await queue.waitUntilReady();
      const client = (await queue.getBackend()
        .client) as unknown as PendingCommands;
      const pending = () =>
        client.commandQueue.length + client.offlineQueue.length;

      const resume = await pauseContainer(valkey.getId());
      const seen: number[] = [];
      try {
        for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
          await expect(
            queue.add("job", {}, { jobId: `frozen-${String(attempt)}` }),
          ).rejects.toThrow();
          seen.push(pending());
        }
      } finally {
        await resume();
      }

      // Without a socket timeout every attempt left its command behind
      // (1, 2, … 12); with it the dead socket is dropped and they are failed.
      expect(Math.max(...seen)).toBeLessThan(PUBLISH_ATTEMPTS / 2);
      await vi.waitFor(() => queue.add("job", {}, { jobId: "after-thaw" }), {
        timeout: 15_000,
        interval: 250,
      });
      expect(await queue.getJob("after-thaw")).toBeDefined();
      await queue.close();
    },
  );
});
