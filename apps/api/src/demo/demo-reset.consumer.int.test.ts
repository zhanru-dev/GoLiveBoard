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
import { QUEUES } from "../queues/queues.module.js";
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  type QueueName,
} from "../queues/queues.js";
import type { Clock } from "../shared/clock.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";
import { DEMO_WORKSPACE } from "./demo-accounts.js";
import {
  DEMO_RESET_SCHEDULER_ID,
  DemoResetConsumer,
  FILE_PURGE_EVERY_MS,
  FILE_PURGE_SCHEDULER_ID,
} from "./demo-reset.consumer.js";
import { DemoSeeder, PURGE_DELAY_MS } from "./demo-seeder.js";

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

  async function startWorker(
    demoMode: boolean,
    consume = true,
    overrides: {
      readonly clock?: Clock;
      readonly env?: Readonly<Record<string, string>>;
    } = {},
  ) {
    const worker = await createTestWorker({
      clock: overrides.clock,
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
        ...overrides.env,
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
    // Purges recorded while demo mode was on are still swept.
    expect(
      await maintenanceQueue(off)?.getJobScheduler(FILE_PURGE_SCHEDULER_ID),
    ).toMatchObject({
      every: FILE_PURGE_EVERY_MS,
      name: MAINTENANCE_JOBS.filePurge,
    });
  });

  it("sweeps recorded file purges also in a deployment that never had demo mode on", async () => {
    const off = await startWorker(false, true, {
      env: { QUEUE_PREFIX: `test-${randomBytes(4).toString("hex")}` },
    });

    expect(
      await maintenanceQueue(off)?.getJobScheduler(FILE_PURGE_SCHEDULER_ID),
    ).toMatchObject({
      every: FILE_PURGE_EVERY_MS,
      name: MAINTENANCE_JOBS.filePurge,
    });
  });

  it("schedules the reset once when several workers start at the same moment", async () => {
    const started = await Promise.all([
      startWorker(true),
      startWorker(true),
      startWorker(true),
    ]);
    const queue = maintenanceQueue(started[0]);

    const schedulers = (await queue?.getJobSchedulers()) ?? [];
    expect(schedulers.map(({ key }) => key).sort()).toEqual(
      [DEMO_RESET_SCHEDULER_ID, FILE_PURGE_SCHEDULER_ID].sort(),
    );
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
      .process({ name: MAINTENANCE_JOBS.demoReset });

    expect(await demoWorkspaces()).toBe(0);
  });

  it("restores the demo workspace when the job runs", async () => {
    const worker = await startWorker(true, false);

    await worker
      .get(DemoResetConsumer)
      .process({ name: MAINTENANCE_JOBS.demoReset });

    expect(await demoWorkspaces()).toBe(1);
  });

  it(
    "deletes a file sent with an upload link from before the reset once the link has expired, however long storage is down",
    { timeout: 60_000 },
    async () => {
      const worker = await startWorker(true, false);
      const seeder = worker.get(DemoSeeder);
      const storage = worker.get(ObjectStorage);
      const sweep = (on: INestApplicationContext) =>
        on.get(DemoResetConsumer).process({ name: MAINTENANCE_JOBS.filePurge });
      await seeder.reset();
      const [event] = await database.query<{ id: string }>(
        "SELECT id FROM events WHERE workspace_id = $1 LIMIT 1",
        [DEMO_WORKSPACE.id],
      );
      const eventId = event?.id ?? "";
      const uploads = uploadKeyFor(eventFilesPrefix(eventId));
      // A visitor asked for an upload link just before the reset...
      const key = `${uploads}holding-slates/late`;
      const body = png();
      const url = await storage.presignUpload(
        key,
        "image/png",
        body.length,
        UPLOAD_URL_TTL_SECONDS,
      );
      await seeder.reset();
      // ...and uses it after: the link still works, and no row refers to the
      // file any more.
      const late = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body,
      });
      expect(late.status).toBe(200);
      const pending = () =>
        database.query<{ prefix: string; not_before: Date }>(
          "SELECT prefix, not_before FROM pending_file_purges WHERE prefix = ANY($1)",
          [[eventFilesPrefix(eventId), uploads]],
        );
      // The reset recorded both prefixes, not to be emptied before the link
      // has expired.
      const recorded = await pending();
      expect(recorded.map(({ prefix }) => prefix).sort()).toEqual(
        [eventFilesPrefix(eventId), uploads].sort(),
      );
      for (const { not_before } of recorded) {
        expect(not_before.getTime()).toBeGreaterThan(
          Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
        );
      }
      await sweep(worker);
      expect(await storage.stat(key)).toBeDefined();

      // Later, with storage down: the sweep fails, and nothing is forgotten.
      const later: Clock = {
        now: () => new Date(Date.now() + PURGE_DELAY_MS + 60_000),
      };
      const storageDown = await startWorker(true, false, {
        clock: later,
        env: { S3_ENDPOINT: "http://127.0.0.1:9", S3_CREATE_BUCKET: "false" },
      });
      await sweep(storageDown);
      await sweep(storageDown);
      expect(await pending()).toHaveLength(2);
      expect(await storage.stat(key)).toBeDefined();

      // Storage answers again, however much later: the next sweep empties both
      // prefixes and forgets them.
      await sweep(await startWorker(true, false, { clock: later }));
      expect(await storage.stat(key)).toBeUndefined();
      expect(await pending()).toHaveLength(0);
    },
  );
});
