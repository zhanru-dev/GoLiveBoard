import { randomBytes } from "node:crypto";

import type { StartedValkeyContainer } from "@testcontainers/valkey";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { pauseContainer, startValkey } from "../testing/containers.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";

/**
 * Command timeout, then the grace period for each close, then forcing them:
 * well under this, and nowhere near "never".
 */
const SHUTDOWN_LIMIT_MS = 15_000;

describe("worker shutdown while Valkey is frozen", () => {
  let database: TestDatabase;
  let valkey: StartedValkeyContainer;

  beforeAll(async () => {
    [database, valkey] = await Promise.all([
      createTestDatabase(),
      startValkey(),
    ]);
    // Returned, not in afterAll: when the start fails, nothing to stop.
    return async () => {
      await valkey.stop();
      await database.drop();
    };
  });

  it(
    "exits within a bound and leaves the unpublished message in the outbox",
    { timeout: 40_000 },
    async () => {
      const worker = await createTestWorker({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: valkey.getConnectionUrl(),
          QUEUE_PREFIX: `test-${randomBytes(4).toString("hex")}`,
        },
        consume: true,
      });
      const [workspace] = await database.query<{ id: string }>(
        "INSERT INTO workspaces (name) VALUES ('Frozen') RETURNING id",
      );
      const resume = await pauseContainer(valkey.getId());
      try {
        await database.query(
          `INSERT INTO outbox_messages (workspace_id, type, payload)
           VALUES ($1, 'stream.check_requested',
                   jsonb_build_object('eventId', uuidv7(), 'requestedAt', '2026-12-01T17:00:00.000Z'))`,
          [workspace?.id],
        );
        // The relay has claimed the message and is waiting on Valkey.
        await vi.waitFor(
          async () => {
            const [claimed] = await database.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_locks AS lock
               JOIN pg_class AS relation ON relation.oid = lock.relation
               WHERE relation.relname = 'outbox_messages' AND lock.mode = 'RowShareLock'`,
            );
            expect(claimed?.count).toBeGreaterThan(0);
          },
          { timeout: 5_000, interval: 50 },
        );

        const started = performance.now();
        await worker.close();

        expect(performance.now() - started).toBeLessThan(SHUTDOWN_LIMIT_MS);
        const [pending] = await database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM outbox_messages WHERE dispatched_at IS NULL",
        );
        expect(pending?.count).toBe(1);
      } finally {
        await resume();
      }
    },
  );
});
