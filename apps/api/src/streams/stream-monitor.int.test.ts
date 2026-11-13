import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  CheckStreamJob,
  Incident,
  Readiness,
  StreamCheckPage,
} from "@opspilot/contracts";
import { type Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { z } from "zod";

import { QUEUES } from "../queues/queues.module.js";
import type { QueueName } from "../queues/queues.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { createEvent, prepareForLaunch } from "../testing/events.js";
import { TestClock } from "../testing/fakes.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { TestStream } from "../testing/test-stream.js";
import { StreamCheckScheduler } from "./stream-check-scheduler.js";
import { StreamChecksConsumer } from "./stream-checks.consumer.js";
import { StreamMonitor } from "./stream-monitor.js";

const Incidents = z.array(Incident);
const SECOND = 1_000;

describe("stream checks and incidents (FR-ST-2)", () => {
  let database: TestDatabase;
  let stream: TestStream;
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let api: ApiClient;
  let owner: TestSession;
  const clock = new TestClock(new Date("2026-12-01T17:30:00.000Z"));
  let slots = 0;

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
    app = await createTestApp({ env, clock, safeHttp: stream.clientOptions() });
    worker = await createTestWorker({
      env: workerEnv,
      clock,
      safeHttp: stream.clientOptions(),
    });
    api = new ApiClient(app);
    owner = await api.newOwner();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await stream.stop();
    await database.drop();
  });

  /** An event starting at 18:00 whose stream is the test stream. */
  async function monitoredEvent(path?: string) {
    const event = await createEvent(api, owner);
    const response = await api.send(
      owner,
      "put",
      `/events/${event.id}/stream`,
      {
        url: stream.url(path),
      },
    );
    expect(response.status, response.text).toBe(200);
    return event;
  }

  /** Runs one check in a new slot, 30 seconds after the previous one. */
  function checkNow(eventId: string) {
    clock.advance(30 * SECOND);
    slots += 1;
    return worker
      .get(StreamMonitor)
      .check(eventId, new Date(Date.UTC(2026, 11, 1, 0, 0, slots)));
  }

  const incidents = async (eventId: string) =>
    Incidents.parse(
      (await api.get(owner, `/events/${eventId}/incidents`)).body,
    );

  const checks = async (eventId: string) =>
    StreamCheckPage.parse(
      (await api.get(owner, `/events/${eventId}/stream/checks`)).body,
    ).items;

  const streamCriterion = async (eventId: string) =>
    Readiness.parse(
      (await api.get(owner, `/events/${eventId}/readiness`)).body,
    ).criteria.find((criterion) => criterion.criterion === "STREAM_REACHABLE");

  it("opens an incident after two failures in a row and resolves it after two successes", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "OK";
    expect(await checkNow(event.id)).toEqual({
      recorded: true,
      incident: "NONE",
    });
    expect(await streamCriterion(event.id)).toMatchObject({ blocking: false });

    stream.behaviour = "NOT_FOUND";
    expect((await checkNow(event.id)).incident).toBe("NONE");
    expect(await incidents(event.id)).toEqual([]);
    expect((await checkNow(event.id)).incident).toBe("OPEN");
    const [opened] = await incidents(event.id);
    expect(opened).toMatchObject({
      kind: "STREAM_UNREACHABLE",
      openedAt: clock.now().toISOString(),
      resolvedAt: null,
    });
    expect(await streamCriterion(event.id)).toMatchObject({
      blocking: true,
      evidence:
        "The last stream check failed less than a minute ago (HTTP 404).",
    });

    expect((await checkNow(event.id)).incident).toBe("NONE");
    expect(await incidents(event.id)).toHaveLength(1);

    stream.behaviour = "OK";
    expect((await checkNow(event.id)).incident).toBe("NONE");
    expect((await incidents(event.id))[0]?.resolvedAt).toBeNull();
    expect((await checkNow(event.id)).incident).toBe("RESOLVE");
    expect(await incidents(event.id)).toEqual([
      { ...opened, resolvedAt: clock.now().toISOString() },
    ]);
    expect((await checks(event.id)).map((check) => check.ok)).toEqual([
      true,
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("records one check per slot, however often the job runs", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "OK";
    const slot = new Date("2026-12-01T17:00:00.000Z");
    const monitor = worker.get(StreamMonitor);

    const outcomes = await Promise.all([
      monitor.check(event.id, slot),
      monitor.check(event.id, slot),
      monitor.check(event.id, slot),
    ]);

    expect(outcomes.filter((outcome) => outcome.recorded)).toHaveLength(1);
    expect(await checks(event.id)).toHaveLength(1);
  });

  it("opens one incident even when failing checks finish together", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "NOT_FOUND";
    const monitor = worker.get(StreamMonitor);

    await Promise.all(
      [1, 2, 3, 4].map((second) =>
        monitor.check(event.id, new Date(Date.UTC(2026, 11, 1, 1, 0, second))),
      ),
    );

    expect(await incidents(event.id)).toHaveLength(1);
  });

  it.each([
    ["HANG", "Timed out after 0.5 seconds"],
    ["NOT_HLS", "The response is not an HLS playlist"],
  ] as const)("explains a %s failure", async (behaviour, failure) => {
    const event = await monitoredEvent();
    stream.behaviour = behaviour;

    await checkNow(event.id);

    expect((await checks(event.id))[0]).toMatchObject({ ok: false, failure });
    stream.behaviour = "OK";
  });

  it("does not count checks of an old URL for a new one", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "OK";
    await checkNow(event.id);

    await api.send(owner, "put", `/events/${event.id}/stream`, {
      url: stream.url(`/redirect?to=${encodeURIComponent(stream.url())}`),
    });

    expect(await streamCriterion(event.id)).toMatchObject({
      blocking: true,
      evidence: "The stream has not been checked yet.",
    });
  });

  it("cannot slip a failed check in between a go-live's readiness check and its commit", async () => {
    const event = await createEvent(api, owner);
    await api.send(owner, "post", `/events/${event.id}/transitions`, {
      to: "CONFIGURING",
    });
    await prepareForLaunch(api, database, owner, event.id, clock.now());
    await api.send(owner, "put", `/events/${event.id}/stream`, {
      url: stream.url(),
    });
    stream.behaviour = "OK";
    await checkNow(event.id);
    const ready = await api.send(
      owner,
      "post",
      `/events/${event.id}/transitions`,
      {
        to: "READY",
      },
    );
    expect(ready.status, ready.text).toBe(200);
    const block = await blockWrites(database.url, "events");

    // Go-live locks the event, finds no blocker, and waits to write…
    const goLive = Promise.resolve(
      api.send(owner, "post", `/events/${event.id}/transitions`, {
        to: "LIVE",
      }),
    );
    await block.waitForWaiters(1);
    // …so a failing check must wait for that lock rather than commit first.
    stream.behaviour = "NOT_FOUND";
    const failing = checkNow(event.id);
    await block.waitForWaiters(2);
    await block.release();

    expect((await goLive).status).toBe(200);
    expect((await failing).recorded).toBe(true);
    const [order] = await database.query<{ checked_after_live: boolean }>(
      `SELECT (
         SELECT id FROM stream_checks WHERE event_id = $1::uuid ORDER BY id DESC LIMIT 1
       ) > (
         SELECT id FROM outbox_messages
         WHERE payload->>'eventId' = $1::text AND payload->>'to' = 'LIVE'
       ) AS checked_after_live`,
      [event.id],
    );
    // UUID v7 IDs are ordered by creation: the check was written after LIVE.
    expect(order?.checked_after_live).toBe(true);
    stream.behaviour = "OK";
  });

  it("drops a result for a URL that was replaced while it was being fetched", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "HANG";

    const pending = checkNow(event.id);
    await api.send(owner, "put", `/events/${event.id}/stream`, {
      url: stream.url(`/redirect?to=${encodeURIComponent(stream.url())}`),
    });

    expect(await pending).toEqual({ recorded: false, incident: "NONE" });
    expect(await checks(event.id)).toEqual([]);
    stream.behaviour = "OK";
  });

  it("skips an event without a stream URL", async () => {
    const event = await createEvent(api, owner);

    expect(await checkNow(event.id)).toEqual({
      recorded: false,
      incident: "NONE",
    });
  });

  it("runs a check job through the consumer", async () => {
    const event = await monitoredEvent();
    stream.behaviour = "OK";

    await worker.get(StreamChecksConsumer).process({
      name: "check",
      data: { eventId: event.id, slot: "2026-12-01T16:00:00.000Z" },
    });

    expect(await checks(event.id)).toHaveLength(1);
  });

  describe("schedule", () => {
    it("enqueues checks for events within an hour of their start, once per slot", async () => {
      // A fresh workspace keeps other tests' events out of the count.
      const scheduledOwner = await api.newOwner("scheduler");
      const at = (iso: string) => ({
        title: iso,
        startsAt: iso,
        endsAt: new Date(Date.parse(iso) + 60 * 60 * SECOND).toISOString(),
        timeZone: "UTC",
      });
      const soon = await createEvent(
        api,
        scheduledOwner,
        at("2026-12-02T10:30:00Z"),
      );
      const later = await createEvent(
        api,
        scheduledOwner,
        at("2026-12-02T12:00:00Z"),
      );
      for (const event of [soon, later]) {
        await api.send(scheduledOwner, "put", `/events/${event.id}/stream`, {
          url: stream.url(),
        });
      }
      await database.query(
        "UPDATE events SET stream_url = NULL WHERE workspace_id <> (SELECT workspace_id FROM events WHERE id = $1)",
        [soon.id],
      );
      const before = clock.now().getTime();
      clock.advance(Date.parse("2026-12-02T10:00:10Z") - before);
      const scheduler = worker.get(StreamCheckScheduler);

      expect(await scheduler.scheduleDueChecks()).toBe(1);
      expect(await scheduler.scheduleDueChecks()).toBe(1);

      const queue = worker
        .get<ReadonlyMap<QueueName, Queue>>(QUEUES)
        .get("stream-checks");
      const jobs = ((await queue?.getJobs(["waiting"])) ?? []).map((job) =>
        CheckStreamJob.parse(job.data),
      );
      expect(jobs.filter((job) => job.eventId === soon.id)).toEqual([
        { eventId: soon.id, slot: "2026-12-02T10:00:00.000Z" },
      ]);
      expect(jobs.some((job) => job.eventId === later.id)).toBe(false);
    });
  });
});
