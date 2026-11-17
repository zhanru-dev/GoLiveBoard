import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@opspilot/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "../demo/demo-accounts.js";
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

/** docs/06 section 10: the shared demo's daily budget for AI triage. */
describe("the demo's AI budget", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let demo: TestSession;
  let events: { id: string }[];

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        DEMO_MODE: "true",
        TRUST_PROXY_HOPS: "1",
        S3_ENDPOINT: inject("s3Endpoint"),
        S3_BUCKET: TEST_S3_BUCKET,
        S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
        S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
        S3_FORCE_PATH_STYLE: "true",
        S3_CREATE_BUCKET: "true",
      },
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
    // The seed's events that are not archived, each with a question.
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

  /** Finished runs on the first event, `ago` before now. */
  async function spent(runs: number, costMicros: number, ago = "1 minute") {
    await database.query(
      `INSERT INTO triage_runs (event_id, question_ids, status, failure, finished_at, cost_micros, created_at)
       SELECT $1, ARRAY[gen_random_uuid()], 'FAILED', 'x', now(), $2, now() - $3::interval
       FROM generate_series(1, $4)`,
      [events[0]?.id, costMicros, ago, runs],
    );
  }

  const start = (eventId: string) =>
    new ApiClient(app, newAddress()).send(
      demo,
      "post",
      `/events/${eventId}/question-triage-runs`,
    );

  const clear = () =>
    database.query("DELETE FROM triage_runs WHERE event_id = ANY($1::uuid[])", [
      events.map(({ id }) => id),
    ]);

  it("stops at its daily count of runs or its daily spend, and counts today only", async () => {
    await clear();
    await spent(DEMO_TRIAGE_DAILY_RUNS, 0);
    const byCount = await start(events[1]?.id ?? "");

    await clear();
    await spent(1, DEMO_TRIAGE_DAILY_MICROS);
    const bySpend = await start(events[1]?.id ?? "");

    await clear();
    await spent(DEMO_TRIAGE_DAILY_RUNS, DEMO_TRIAGE_DAILY_MICROS, "2 days");
    const yesterday = await start(events[1]?.id ?? "");

    expect(ProblemDetails.parse(byCount.body).code).toBe("TRIAGE_BUDGET_SPENT");
    expect(byCount.status).toBe(429);
    expect(ProblemDetails.parse(bySpend.body).code).toBe("TRIAGE_BUDGET_SPENT");
    expect(yesterday.status, yesterday.text).toBe(202);
  });

  it("lets one of two runs through when one is left, also at the same moment", async () => {
    await clear();
    await spent(DEMO_TRIAGE_DAILY_RUNS - 1, 0);
    // Both requests queue behind the budget's lock, then go together.
    const block = await holdLock(
      database.url,
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`triage-budget:${DEMO_WORKSPACE.id}`],
    );
    let statuses: number[];
    try {
      const both = Promise.all([
        Promise.resolve(start(events[1]?.id ?? "")),
        Promise.resolve(start(events[2]?.id ?? "")),
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
});
