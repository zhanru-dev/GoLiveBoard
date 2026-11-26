import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Queue } from "bullmq";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import { ACCESS_COOKIE } from "../auth/cookies.js";
import { QUEUES } from "../queues/queues.module.js";
import { MAINTENANCE_QUEUE, type QueueName } from "../queues/queues.js";
import { ApiClient } from "../testing/api-client.js";
import { cookieHeader } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { captureMetrics, type CapturedMetrics } from "../testing/metrics.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { METRICS } from "./metrics.js";

/** The value of the data point whose attributes include `match`. */
async function valueOf(
  captured: CapturedMetrics,
  name: string,
  match: Record<string, unknown> = {},
): Promise<number | undefined> {
  const point = (await captured.points(name)).find(({ attributes }) =>
    Object.entries(match).every(([key, value]) => attributes[key] === value),
  );
  return point?.value as number | undefined;
}

/** docs/06, section 7: the metrics the dashboards and alerts read. */
describe("application metrics", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let captured: CapturedMetrics;
  const env = () => ({
    DATABASE_URL: database.url,
    VALKEY_URL: inject("valkeyUrl"),
    TRUST_PROXY_HOPS: "1",
    // A prefix of its own: the counts are of this file's jobs only.
    QUEUE_PREFIX: `metrics-${String(Date.now())}`,
  });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await captured.stop();
  });

  afterAll(async () => {
    await database.drop();
  });

  it("counts the real-time connections open on the instance", async () => {
    captured = captureMetrics();
    const app: NestExpressApplication = await createTestApp({
      env: env(),
      mailer: new CapturingMailer(),
    });
    try {
      const url = await listen(app);
      const client = new ApiClient(app, "198.18.40.1");
      const owner = await client.newOwner();
      const cookie = cookieHeader({ [ACCESS_COOKIE]: owner.access });
      const before = await valueOf(captured, METRICS.realtimeConnections);

      const first = await RealtimeClient.connect(url, { cookie });
      const second = await RealtimeClient.connect(url, { cookie });
      const open = await valueOf(captured, METRICS.realtimeConnections);
      first.close();
      second.close();

      expect(before).toBe(0);
      expect(open).toBe(2);
      await expect
        .poll(() => valueOf(captured, METRICS.realtimeConnections))
        .toBe(0);
    } finally {
      await app.close();
    }
  });

  it("reports each queue's depth, its oldest waiting job's age, and the oldest unrelayed outbox message's", async () => {
    captured = captureMetrics();
    const worker: INestApplicationContext = await createTestWorker({
      env: env(),
    });
    try {
      const queue = worker
        .get<ReadonlyMap<QueueName, Queue>>(QUEUES)
        .get(MAINTENANCE_QUEUE);
      await queue?.add("first", {}, { jobId: "first" });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      // A newer one does not make the oldest any younger.
      await queue?.add("second", {}, { jobId: "second" });
      const [{ id: workspaceId } = { id: "" }] = await database.query<{
        id: string;
      }>("INSERT INTO workspaces (name) VALUES ('Metrics') RETURNING id");
      await database.query(
        `INSERT INTO outbox_messages (workspace_id, type, payload, created_at)
         VALUES ($1, 'event.transitioned', '{}', now() - interval '10 minutes')`,
        [workspaceId],
      );

      const waiting = await valueOf(captured, METRICS.queueJobs, {
        "goliveboard.queue": MAINTENANCE_QUEUE,
        "goliveboard.queue.state": "wait",
      });
      const oldest = await valueOf(captured, METRICS.queueOldestJobAge, {
        "goliveboard.queue": MAINTENANCE_QUEUE,
      });
      const outbox = await valueOf(captured, METRICS.outboxOldestMessageAge);

      expect(waiting).toBe(2);
      expect(oldest).toBeGreaterThanOrEqual(1.2);
      expect(oldest).toBeLessThan(30);
      expect(outbox).toBeGreaterThanOrEqual(600);
      expect(outbox).toBeLessThan(700);
    } finally {
      await worker.close();
    }
  });
});
