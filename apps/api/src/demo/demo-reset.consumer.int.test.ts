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

import { QUEUES } from "../queues/queues.module.js";
import {
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  type QueueName,
} from "../queues/queues.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";
import { DEMO_WORKSPACE } from "./demo-accounts.js";
import {
  DEMO_RESET_SCHEDULER_ID,
  DemoResetConsumer,
} from "./demo-reset.consumer.js";

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
});
