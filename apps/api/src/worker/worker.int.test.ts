import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Readiness, StreamCheckPage } from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ApiClient } from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createEvent } from "../testing/events.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { TestStream } from "../testing/test-stream.js";

/** Generous: the relay polls every 0.5 s and BullMQ picks jobs up at once. */
const WAIT_LIMIT_MS = 15_000;
const POLL_MS = 100;

describe("worker process, end to end", () => {
  let database: TestDatabase;
  let stream: TestStream;
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let api: ApiClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    stream = await TestStream.start();
    // Only the worker gets the real Valkey: the API's rate limits would
    // count this file's sign-ups together with other files' by address.
    const env = { DATABASE_URL: database.url };
    const workerEnv = {
      ...env,
      VALKEY_URL: inject("valkeyUrl"),
      QUEUE_PREFIX: `test-${randomBytes(4).toString("hex")}`,
    };
    app = await createTestApp({ env, safeHttp: stream.clientOptions() });
    worker = await createTestWorker({
      env: workerEnv,
      safeHttp: stream.clientOptions(),
      consume: true,
    });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await stream.stop();
    await database.drop();
  });

  it("checks a stream moments after its URL is set: API → outbox → relay → queue → check", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    await api.send(owner, "put", `/events/${event.id}/stream`, {
      url: stream.url(),
    });

    const deadline = Date.now() + WAIT_LIMIT_MS;
    let checks: StreamCheckPage["items"] = [];
    while (checks.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      checks = StreamCheckPage.parse(
        (await api.get(owner, `/events/${event.id}/stream/checks`)).body,
      ).items;
    }
    expect(checks).toEqual([
      expect.objectContaining({ ok: true, httpStatus: 200, url: stream.url() }),
    ]);
    const readiness = Readiness.parse(
      (await api.get(owner, `/events/${event.id}/readiness`)).body,
    );
    expect(
      readiness.blockers.some((b) => b.criterion === "STREAM_REACHABLE"),
    ).toBe(false);
  });
});
