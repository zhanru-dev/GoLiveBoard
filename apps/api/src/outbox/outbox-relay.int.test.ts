import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { JobPublisher } from "../queues/job-publisher.js";
import { QUEUES } from "../queues/queues.module.js";
import type { QueueName } from "../queues/queues.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";
import { OutboxRelay } from "./outbox-relay.js";

describe("outbox relay (ADR-0007)", () => {
  let database: TestDatabase;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  let queue: Queue;
  let workspaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    worker = await createTestWorker({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        QUEUE_PREFIX: `test-${randomBytes(4).toString("hex")}`,
      },
    });
    relay = worker.get(OutboxRelay);
    const found = worker
      .get<ReadonlyMap<QueueName, Queue>>(QUEUES)
      .get("stream-checks");
    if (found === undefined) {
      throw new Error("No stream-checks queue");
    }
    queue = found;
    const [workspace] = await database.query<{ id: string }>(
      "INSERT INTO workspaces (name) VALUES ('Relay') RETURNING id",
    );
    workspaceId = workspace?.id ?? "";
  });

  afterAll(async () => {
    await worker.close();
    await database.drop();
  });

  async function drain(): Promise<void> {
    while ((await relay.relayOnce()) > 0) {
      // Keep going until nothing is left.
    }
    await queue.drain();
  }

  async function writeCheckRequests(count: number): Promise<string[]> {
    const rows = await database.query<{ id: string }>(
      `INSERT INTO outbox_messages (workspace_id, type, payload)
       SELECT $1, 'stream.check_requested',
              jsonb_build_object('eventId', uuidv7(), 'requestedAt', '2026-12-01T17:00:00.000Z')
       FROM generate_series(1, $2)
       RETURNING id`,
      [workspaceId, count],
    );
    return rows.map((row) => row.id);
  }

  const undispatched = async () =>
    (
      await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM outbox_messages WHERE dispatched_at IS NULL",
      )
    )[0]?.count;

  it("turns committed messages into jobs and marks them dispatched", async () => {
    await drain();
    const ids = await writeCheckRequests(3);

    expect(await relay.relayOnce()).toBe(3);

    expect(await undispatched()).toBe(0);
    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs.map((job) => job.id).sort()).toEqual(
      ids.map((id) => `outbox-${id}`).sort(),
    );
  });

  it("enqueues one job when a message is relayed twice", async () => {
    await drain();
    const [id] = await writeCheckRequests(1);
    await relay.relayOnce();
    // As if the relay had crashed after publishing, before committing.
    await database.query(
      "UPDATE outbox_messages SET dispatched_at = NULL WHERE id = $1",
      [id],
    );

    await relay.relayOnce();

    const jobs = await queue.getJobs(["waiting"]);
    expect(
      jobs.filter((job) => job.id === `outbox-${String(id)}`),
    ).toHaveLength(1);
  });

  it("lets a second relay skip messages the first has claimed", async () => {
    await drain();
    await writeCheckRequests(5);
    const publish = vi.spyOn(worker.get(JobPublisher), "publish");
    publish.mockClear();
    const block = await blockWrites(database.url, "outbox_messages");

    // The first relay claims all five, publishes, and waits to mark them…
    const first = relay.relayOnce();
    await block.waitForWaiters(1);
    // …so the second finds them locked and takes nothing.
    const second = await relay.relayOnce();
    await block.release();

    expect(second).toBe(0);
    expect(await first).toBe(5);
    expect(publish).toHaveBeenCalledTimes(5);
    publish.mockRestore();
  });

  it("marks types that nothing consumes yet as dispatched without a job", async () => {
    await drain();
    await database.query(
      `INSERT INTO outbox_messages (workspace_id, type, payload)
       VALUES ($1, 'event.transitioned', '{}')`,
      [workspaceId],
    );

    expect(await relay.relayOnce()).toBe(1);
    expect(await undispatched()).toBe(0);
    expect(await queue.getJobs(["waiting"])).toEqual([]);
  });

  it("does not let a malformed message block the ones behind it", async () => {
    await drain();
    await database.query(
      `INSERT INTO outbox_messages (workspace_id, type, payload)
       VALUES ($1, 'stream.check_requested', '{"eventId": "not-a-uuid"}')`,
      [workspaceId],
    );
    await writeCheckRequests(1);

    expect(await relay.relayOnce()).toBe(2);
    expect(await queue.getJobs(["waiting"])).toHaveLength(1);
  });
});
