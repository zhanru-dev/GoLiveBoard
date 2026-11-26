import type { StartedValkeyContainer } from "@testcontainers/valkey";
import type { Redis } from "ioredis";
import type { PinoLogger } from "nestjs-pino";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { RateLimiter } from "../rate-limit/rate-limiter.js";
import { loadTestConfig } from "../testing/config.js";
import { pauseContainer, startValkey } from "../testing/containers.js";
import {
  closeValkeyClient,
  COMMAND_TIMEOUT_MS,
  createValkeyClient,
  SOCKET_TIMEOUT_MS,
} from "./valkey.js";

const RULE = { name: "frozen-test", limit: 100, windowMs: 60_000 };

/**
 * The shared client against a Valkey that hangs: rate limits must fail open
 * at once, timed-out commands must not pile up on the connection, and the
 * client must recover by itself (the milestone 2 review).
 */
describe("the shared Valkey client while Valkey is frozen", () => {
  let valkey: StartedValkeyContainer;
  let client: Redis;
  let limiter: RateLimiter;
  const logger = { warn: vi.fn() } as unknown as PinoLogger;

  beforeAll(async () => {
    valkey = await startValkey();
    client = createValkeyClient(
      loadTestConfig({ VALKEY_URL: valkey.getConnectionUrl() }),
    );
    await vi.waitFor(() => {
      expect(client.status).toBe("ready");
    });
    limiter = new RateLimiter(client, logger);
    // Returned, not in afterAll: when the start fails, there is nothing to
    // close, and the failure stays the only error reported.
    return async () => {
      await closeValkeyClient(client);
      await valkey.stop();
    };
  });

  /** Three rate-limit checks at once; resolves with how long they took. */
  async function burst(subject: string): Promise<number> {
    const startedAt = performance.now();
    const results = await Promise.all(
      [1, 2, 3].map(() => limiter.consume(RULE, subject)),
    );
    expect(results).toEqual([true, true, true]);
    return performance.now() - startedAt;
  }

  it(
    "fails open within the command timeout, drops the backlog and recovers",
    { timeout: 30_000 },
    async () => {
      expect(await burst("before")).toBeLessThan(COMMAND_TIMEOUT_MS);
      const resume = await pauseContainer(valkey.getId());
      try {
        // Both bursts are abandoned after the command timeout...
        expect(await burst("frozen")).toBeLessThan(COMMAND_TIMEOUT_MS + 300);
        expect(await burst("frozen")).toBeLessThan(COMMAND_TIMEOUT_MS + 300);
        // A limit that bounds what is stored refuses instead (503).
        await expect(
          limiter.consume({ ...RULE, failClosed: true }, "frozen"),
        ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        // ...and once the socket has been silent for its timeout, it is
        // destroyed, failing everything queued on it. Without that, the queue
        // would grow with every request for as long as Valkey stays frozen.
        // Waited for rather than slept for: on a busy machine the timer fires
        // a little late, but it must fire well within three timeouts.
        await vi.waitFor(
          () => {
            // At most the ready check of the next connection attempt waits.
            expect(client.commandQueue.length).toBeLessThanOrEqual(1);
          },
          { timeout: 3 * SOCKET_TIMEOUT_MS, interval: 50 },
        );
        // While the client reconnects, checks fail at once, without queueing.
        expect(await burst("frozen")).toBeLessThan(100);
        expect(client.commandQueue.length).toBeLessThanOrEqual(1);
      } finally {
        await resume();
      }

      await vi.waitFor(
        () => {
          expect(client.status).toBe("ready");
        },
        { timeout: 10_000, interval: 100 },
      );
      expect(await burst("after")).toBeLessThan(COMMAND_TIMEOUT_MS);
      expect(await client.get("goliveboard:rate:frozen-test:after")).toBe("3");
    },
  );
});
