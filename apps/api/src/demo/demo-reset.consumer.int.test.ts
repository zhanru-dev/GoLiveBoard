import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { Queue } from "bullmq";
import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import {
  eventFilesPrefix,
  uploadKeyFor,
  UPLOAD_URL_TTL_SECONDS,
} from "../assets/assets.service.js";
import { OutboxRelay } from "../outbox/outbox-relay.js";
import { DEMO_PURGE_JOB_OPTIONS } from "../outbox/outbox-routes.js";
import { QUEUES } from "../queues/queues.module.js";
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  type QueueName,
} from "../queues/queues.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";
import { DEMO_WORKSPACE } from "./demo-accounts.js";
import {
  DEMO_RESET_SCHEDULER_ID,
  DemoResetConsumer,
} from "./demo-reset.consumer.js";
import { DemoSeeder } from "./demo-seeder.js";

/** A PNG signature followed by filler. */
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2_040, 0x42),
  ]);

describe("the nightly demo reset (FR-AUTH-5)", () => {
  let database: TestDatabase;
  // One queue prefix for the file, so a later worker sees what an earlier
  // one scheduled.
  const prefix = `test-${randomBytes(4).toString("hex")}`;
  const workers: INestApplicationContext[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
  });

  afterAll(async () => {
    await database.drop();
  });

  async function startWorker(demoMode: boolean, consume = true) {
    const worker = await createTestWorker({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        QUEUE_PREFIX: prefix,
        DEMO_MODE: String(demoMode),
        S3_ENDPOINT: inject("s3Endpoint"),
        S3_BUCKET: TEST_S3_BUCKET,
        S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
        S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
        S3_FORCE_PATH_STYLE: "true",
        S3_CREATE_BUCKET: "true",
      },
      consume,
    });
    workers.push(worker);
    return worker;
  }

  const maintenanceQueue = (worker: INestApplicationContext) =>
    worker.get<ReadonlyMap<QueueName, Queue>>(QUEUES).get(MAINTENANCE_QUEUE);

  async function demoWorkspaces(): Promise<number> {
    const [row] = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM workspaces WHERE id = $1",
      [DEMO_WORKSPACE.id],
    );
    return row?.count ?? 0;
  }

  it("runs at 03:00 UK time while demo mode is on, and stops when it is switched off", async () => {
    const on = await startWorker(true);

    expect(
      await maintenanceQueue(on)?.getJobScheduler(DEMO_RESET_SCHEDULER_ID),
    ).toMatchObject({
      pattern: "0 3 * * *",
      tz: "Europe/London",
      name: MAINTENANCE_JOBS.demoReset,
    });

    await on.close();
    workers.splice(0);
    const off = await startWorker(false);

    expect(
      await maintenanceQueue(off)?.getJobScheduler(DEMO_RESET_SCHEDULER_ID),
    ).toBeUndefined();
  });

  it("schedules the reset once when several workers start at the same moment", async () => {
    const started = await Promise.all([
      startWorker(true),
      startWorker(true),
      startWorker(true),
    ]);
    const queue = maintenanceQueue(started[0]);

    const schedulers = (await queue?.getJobSchedulers()) ?? [];
    expect(schedulers.map(({ key }) => key)).toEqual([DEMO_RESET_SCHEDULER_ID]);
    // One next run is waiting, not one per worker.
    const waiting = (await queue?.getDelayed()) ?? [];
    expect(
      waiting.filter(({ name }) => name === MAINTENANCE_JOBS.demoReset),
    ).toHaveLength(1);
  });

  it("does nothing with a reset queued before demo mode was switched off", async () => {
    const worker = await startWorker(false, false);

    await worker
      .get(DemoResetConsumer)
      .process({ name: MAINTENANCE_JOBS.demoReset, data: {} });

    expect(await demoWorkspaces()).toBe(0);
  });

  it("restores the demo workspace when the job runs", async () => {
    const worker = await startWorker(true, false);

    await worker
      .get(DemoResetConsumer)
      .process({ name: MAINTENANCE_JOBS.demoReset, data: {} });

    expect(await demoWorkspaces()).toBe(1);
  });

  it("deletes a file sent with an upload link from before the reset, once every such link has expired", async () => {
    const worker = await startWorker(true, false);
    const seeder = worker.get(DemoSeeder);
    const storage = worker.get(ObjectStorage);
    await seeder.reset();
    const [event] = await database.query<{ id: string }>(
      "SELECT id FROM events WHERE workspace_id = $1 LIMIT 1",
      [DEMO_WORKSPACE.id],
    );
    const eventId = event?.id ?? "";
    // A visitor asked for an upload link just before the reset...
    const key = uploadKeyFor(`${eventFilesPrefix(eventId)}holding-slates/late`);
    const body = png();
    const url = await storage.presignUpload(
      key,
      "image/png",
      body.length,
      UPLOAD_URL_TTL_SECONDS,
    );
    await seeder.reset();
    // ...and uses it after: the link still works, and nothing refers to
    // the file any more.
    const late = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(late.status).toBe(200);
    expect(await storage.stat(key)).toBeDefined();

    // The reset recorded the deleted events; the relay turns that into a
    // purge that waits until the link has expired.
    const [message] = await database.query<{ id: string }>(
      `SELECT id FROM outbox_messages
       WHERE type = 'demo.events_deleted' AND payload->'eventIds' ? $1`,
      [eventId],
    );
    await worker.get(OutboxRelay).relayOnce();
    const purge = await maintenanceQueue(worker)?.getJob(
      `outbox-${message?.id ?? ""}`,
    );
    expect(purge?.name).toBe(MAINTENANCE_JOBS.demoPurgeFiles);
    expect(purge?.opts).toMatchObject(DEMO_PURGE_JOB_OPTIONS);
    expect(purge?.opts.delay).toBeGreaterThan(UPLOAD_URL_TTL_SECONDS * 1000);

    await worker
      .get(DemoResetConsumer)
      .process({ name: purge?.name ?? "", data: purge?.data as unknown });

    expect(await storage.stat(key)).toBeUndefined();
  });
});
