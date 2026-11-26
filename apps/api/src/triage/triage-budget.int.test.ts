import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@goliveboard/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "../demo/demo-accounts.js";
import { openEvent } from "../testing/admission.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { setCookies } from "../testing/cookies.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";
import {
  dateIn,
  DEMO_TIME_ZONE,
  DEMO_TRIAGE_DAILY_MICROS,
  DEMO_TRIAGE_DAILY_RUNS,
} from "./domain/budget.js";
import { type TriageAnswer, TriageModel } from "./triage-model.js";

let addressCounter = 0;
const newAddress = () => `198.18.12.${String((addressCounter += 1) % 250)}`;

class NeverCalled extends TriageModel {
  triage(): Promise<TriageAnswer> {
    return Promise.reject(new Error("The API never calls the model"));
  }
}

/** docs/06 section 10: what a workspace may spend on AI triage each day. */
describe("the AI budget", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let demo: TestSession;
  let events: { id: string }[];
  const today = () => dateIn(new Date(), DEMO_TIME_ZONE);

  const env = () => ({
    DATABASE_URL: database.url,
    VALKEY_URL: inject("valkeyUrl"),
    TRUST_PROXY_HOPS: "1",
    S3_ENDPOINT: inject("s3Endpoint"),
    S3_BUCKET: TEST_S3_BUCKET,
    S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
    S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
    S3_FORCE_PATH_STYLE: "true",
    S3_CREATE_BUCKET: "true",
  });

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: { ...env(), DEMO_MODE: "true" },
      mailer: new CapturingMailer(),
      triageModel: new NeverCalled(),
    });
    const signedIn = await request(app.getHttpServer())
      .post("/api/v1/auth/demo")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", newAddress());
    expect(signedIn.status, signedIn.text).toBe(204);
    const cookies = setCookies(signedIn);
    demo = {
      email: DEMO_PEOPLE.manager.email,
      access: cookies.get(ACCESS_COOKIE)?.value ?? "",
      refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
    };
    events = await database.query<{ id: string }>(
      "SELECT id FROM events WHERE workspace_id = $1 AND status <> 'ARCHIVED' ORDER BY id",
      [DEMO_WORKSPACE.id],
    );
    for (const event of events) {
      await database.query(
        `INSERT INTO questions (event_id, author_user_id, body, status)
         VALUES ($1, $2, 'Is it recorded?', 'PUBLISHED')`,
        [event.id, DEMO_PEOPLE.manager.id],
      );
    }
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  /** The demo's spend for a day, as the ledger holds it. */
  const spend = (
    day: string,
    values: { runs?: number; spent?: number; reserved?: number },
  ) =>
    database.query(
      `INSERT INTO triage_spend (workspace_id, day, runs, spent_micros, reserved_micros)
       VALUES ($1, $2::date, $3, $4, $5)
       ON CONFLICT (workspace_id, day) DO UPDATE
       SET runs = $3, spent_micros = $4, reserved_micros = $5`,
      [
        DEMO_WORKSPACE.id,
        day,
        values.runs ?? 0,
        values.spent ?? 0,
        values.reserved ?? 0,
      ],
    );

  const start = (session: TestSession, eventId: string, on = app) =>
    new ApiClient(on, newAddress()).send(
      session,
      "post",
      `/events/${eventId}/question-triage-runs`,
    );

  const reset = async () => {
    await database.query(
      "DELETE FROM triage_runs WHERE event_id = ANY($1::uuid[])",
      [events.map(({ id }) => id)],
    );
    await database.query("DELETE FROM triage_spend WHERE workspace_id = $1", [
      DEMO_WORKSPACE.id,
    ]);
  };

  it("stops the demo at its daily count, or when spent and reserved money would pass a dollar", async () => {
    await reset();
    await spend(today(), { runs: DEMO_TRIAGE_DAILY_RUNS });
    const byCount = await start(demo, events[1]?.id ?? "");

    await spend(today(), { spent: DEMO_TRIAGE_DAILY_MICROS - 5_000 });
    const bySpend = await start(demo, events[1]?.id ?? "");

    // Runs at the moment hold their worst cost: it counts too.
    await spend(today(), { reserved: DEMO_TRIAGE_DAILY_MICROS - 5_000 });
    const byReserved = await start(demo, events[1]?.id ?? "");

    for (const refused of [byCount, bySpend, byReserved]) {
      expect(refused.status).toBe(429);
      expect(ProblemDetails.parse(refused.body).code).toBe(
        "TRIAGE_BUDGET_SPENT",
      );
    }
  });

  it("counts today only", async () => {
    await reset();
    await spend("2020-01-01", {
      runs: DEMO_TRIAGE_DAILY_RUNS,
      spent: DEMO_TRIAGE_DAILY_MICROS,
    });

    const allowed = await start(demo, events[1]?.id ?? "");

    expect(allowed.status, allowed.text).toBe(202);
  });

  it("keeps the day's spend when the demo's events are deleted (its nightly reset)", async () => {
    await reset();
    const started = await start(demo, events[1]?.id ?? "");
    expect(started.status, started.text).toBe(202);
    const [before] = await database.query<{
      runs: number;
      reserved_micros: string;
    }>(
      "SELECT runs, reserved_micros::text FROM triage_spend WHERE workspace_id = $1 AND day = $2::date",
      [DEMO_WORKSPACE.id, today()],
    );

    // What the reset does to the runs: they go with their events.
    await database.query("DELETE FROM triage_runs WHERE event_id = $1", [
      events[1]?.id,
    ]);

    const [after] = await database.query<{
      runs: number;
      reserved_micros: string;
    }>(
      "SELECT runs, reserved_micros::text FROM triage_spend WHERE workspace_id = $1 AND day = $2::date",
      [DEMO_WORKSPACE.id, today()],
    );
    expect(before?.runs).toBe(1);
    expect(Number(before?.reserved_micros)).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it("lets one of two runs through when only one fits, also at the same moment", async () => {
    await reset();
    // Room for one run's reservation, not two.
    await spend(today(), { spent: DEMO_TRIAGE_DAILY_MICROS - 60_000 });
    const block = await holdLock(
      database.url,
      "SELECT 1 FROM triage_spend WHERE workspace_id = $1 AND day = $2::date FOR UPDATE",
      [DEMO_WORKSPACE.id, today()],
    );
    let statuses: number[];
    try {
      const both = Promise.all([
        Promise.resolve(start(demo, events[1]?.id ?? "")),
        Promise.resolve(start(demo, events[2]?.id ?? "")),
      ]);
      await block.waitForWaiters(2);
      await block.release();
      statuses = (await both).map(({ status }) => status);
    } catch (error) {
      await block.release().catch(() => undefined);
      throw error;
    }

    expect(statuses.sort()).toEqual([202, 429]);
  });

  it("counts a run in the UK day it started, also just after UK midnight in summer", async () => {
    // 00:30 on 2 July in London, still 1 July in UTC.
    const clock = { now: () => new Date("2026-07-01T23:30:00.000Z") };
    const atNight = await createTestApp({
      env: env(),
      mailer: new CapturingMailer(),
      triageModel: new NeverCalled(),
      clock,
    });
    try {
      const client = new ApiClient(atNight, newAddress());
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      await client.send(owner, "post", `/events/${event.id}/questions`, {
        body: "Is it recorded?",
      });

      const started = await start(owner, event.id, atNight);

      expect(started.status, started.text).toBe(202);
      const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
      const [day] = await database.query<{ day: string; runs: number }>(
        "SELECT day::text, runs FROM triage_spend WHERE workspace_id = $1",
        [workspaceId],
      );
      const [run] = await database.query<{ spend_day: string }>(
        "SELECT spend_day::text FROM triage_runs WHERE event_id = $1",
        [event.id],
      );
      expect(day).toEqual({ day: "2026-07-02", runs: 1 });
      expect(run?.spend_day).toBe("2026-07-02");
    } finally {
      await atNight.close();
    }
  });

  it("holds a real workspace to TRIAGE_DAILY_BUDGET_USD when it is set, and to nothing when not", async () => {
    const capped = await createTestApp({
      env: { ...env(), TRIAGE_DAILY_BUDGET_USD: "0.01" },
      mailer: new CapturingMailer(),
      triageModel: new NeverCalled(),
    });
    try {
      const client = new ApiClient(capped, newAddress());
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      await client.send(owner, "post", `/events/${event.id}/questions`, {
        body: "Is it recorded?",
      });
      const free = new ApiClient(app, newAddress());
      const other = await free.newOwner();
      const otherEvent = await openEvent(free, other);
      await free.send(other, "post", `/events/${otherEvent.id}/questions`, {
        body: "Is it recorded?",
      });

      // One run's worst cost is more than a cent.
      const refused = await start(owner, event.id, capped);
      const unlimited = await start(other, otherEvent.id);

      expect(ProblemDetails.parse(refused.body).code).toBe(
        "TRIAGE_BUDGET_SPENT",
      );
      expect(unlimited.status, unlimited.text).toBe(202);
    } finally {
      await capped.close();
    }
  });
});
