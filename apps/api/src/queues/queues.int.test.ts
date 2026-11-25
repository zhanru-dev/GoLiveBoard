import { randomBytes } from "node:crypto";

import type { StartedValkeyContainer } from "@testcontainers/valkey";
import { Queue } from "bullmq";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config/app-config.js";
import { pauseContainer, startValkey } from "../testing/containers.js";
import { producerConnection } from "./queues.js";

interface QueuedCommand {
  readonly command: { readonly name: string };
}

/** What ioredis keeps for commands that have not been answered yet. */
interface PendingCommands {
  readonly commandQueue: { toArray(): QueuedCommand[] };
  readonly offlineQueue: { toArray(): QueuedCommand[] };
}

/**
 * BullMQ adds a job with a Lua script. Reconnecting also queues handshake
 * commands (`hello`, `client`), a few at a time however long Valkey stays
 * frozen; only the scripts can pile up, so only they are counted.
 */
const PUBLISH_COMMANDS = new Set(["eval", "evalsha"]);

const PUBLISH_ATTEMPTS = 12;

describe("producer connection while Valkey is frozen", () => {
  let valkey: StartedValkeyContainer;

  beforeAll(async () => {
    valkey = await startValkey();
    // Returned, not in afterAll: when the start fails, nothing to stop.
    return () => valkey.stop();
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
        [...client.commandQueue.toArray(), ...client.offlineQueue.toArray()]
          .map((queued) => queued.command.name)
          .filter((name) => PUBLISH_COMMANDS.has(name)).length;

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
