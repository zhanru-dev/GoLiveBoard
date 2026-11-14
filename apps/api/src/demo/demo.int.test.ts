import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { AssetUpload, EventPage, ProblemDetails } from "@opspilot/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { eventFilesPrefix, uploadKeyFor } from "../assets/assets.service.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { setCookies } from "../testing/cookies.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { createEvent } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "./demo-accounts.js";
import { DemoSeeder } from "./demo-seeder.js";

const SEED_TITLES = [
  "Autumn product launch",
  "Customer conference",
  "Quarterly all-hands",
  "Spring partner webinar",
];

/** A PNG signature followed by filler. */
const png = (size = 2_048) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(size - 8, 0x42),
  ]);

/** Stores a small PNG at `key`, through a presigned URL. */
async function put(storage: ObjectStorage, key: string): Promise<void> {
  const body = png();
  const url = await storage.presignUpload(key, "image/png", body.length, 60);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body,
  });
  expect(response.status).toBe(200);
}

let addressCounter = 0;
/** Each test its own client address, so rate limits never meet. */
const newAddress = () => `198.51.100.${String((addressCounter += 1))}`;

async function startApp(database: TestDatabase, demoMode: boolean) {
  return createTestApp({
    env: {
      DATABASE_URL: database.url,
      VALKEY_URL: inject("valkeyUrl"),
      DEMO_MODE: String(demoMode),
      TRUST_PROXY_HOPS: "1",
      S3_ENDPOINT: inject("s3Endpoint"),
      S3_BUCKET: TEST_S3_BUCKET,
      S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
      S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
      S3_CREATE_BUCKET: "true",
    },
    mailer: new CapturingMailer(),
  });
}

function demoSignIn(app: NestExpressApplication, address = newAddress()) {
  return request(app.getHttpServer())
    .post("/api/v1/auth/demo")
    .set("Origin", TEST_ORIGIN)
    .set("X-Forwarded-For", address);
}

/** Signs in to the demo; fails the test if that fails. */
async function demoSession(app: NestExpressApplication): Promise<TestSession> {
  const response = await demoSignIn(app);
  expect(response.status, response.text).toBe(204);
  const cookies = setCookies(response);
  return {
    email: DEMO_PEOPLE.manager.email,
    access: cookies.get(ACCESS_COOKIE)?.value ?? "",
    refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
  };
}

async function eventTitles(
  api: ApiClient,
  session: TestSession,
): Promise<string[]> {
  const response = await api.get(session, "/events?limit=100");
  expect(response.status, response.text).toBe(200);
  return EventPage.parse(response.body)
    .items.map(({ title }) => title)
    .sort();
}

describe("demo mode (FR-AUTH-5)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await startApp(database, true);
    api = new ApiClient(app, newAddress());
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("signs a visitor in with one click, as a Manager of the shared demo workspace", async () => {
    const response = await demoSignIn(app);

    expect(response.status).toBe(204);
    const cookies = setCookies(response);
    expect(cookies.get(ACCESS_COOKIE)?.value).toBeTruthy();
    expect(cookies.get(REFRESH_COOKIE)?.value).toBeTruthy();

    const session = await demoSession(app);
    const me = await api.me(session);
    expect(me.activeWorkspace).toEqual({
      workspaceId: DEMO_WORKSPACE.id,
      workspaceName: DEMO_WORKSPACE.name,
      role: "MANAGER",
      isDemo: true,
    });
    expect(me.memberships).toHaveLength(1);
    expect(await eventTitles(api, session)).toEqual(SEED_TITLES);
  });

  it("refuses a demo sign-in from another site", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/demo")
      .set("Origin", "https://evil.example");

    expect(response.status).toBe(403);
    expect(ProblemDetails.parse(response.body).code).toBe("ORIGIN_FORBIDDEN");
  });

  it("limits demo sign-ins per address", async () => {
    const address = newAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      statuses.push((await demoSignIn(app, address)).status);
    }

    expect(statuses.slice(0, 20)).toEqual(
      Array.from({ length: 20 }, () => 204),
    );
    expect(statuses[20]).toBe(429);
    // Another address is not affected.
    expect((await demoSignIn(app)).status).toBe(204);
  });

  it("gives nobody a way in through the demo accounts' passwords or email", async () => {
    const signIn = await api.signIn(
      DEMO_PEOPLE.manager.email,
      "any password at all",
    );
    const reset = await api.post("/auth/password-reset/request", {
      email: DEMO_PEOPLE.owner.email,
    });
    const signUp = await api.signUp(DEMO_PEOPLE.analyst.email);

    for (const response of [signIn, reset, signUp]) {
      expect(response.status).toBe(400);
      expect(ProblemDetails.parse(response.body).code).toBe(
        "VALIDATION_FAILED",
      );
    }
  });

  it("puts the demo back to its seed, keeps visitors signed in and touches no other workspace", async () => {
    const visitor = await demoSession(app);
    const owner = await api.newOwner();
    const realEvent = await createEvent(api, owner);
    // What visitors leave behind: an event (created with an idempotency
    // key), a change to a seeded one, and a holding slate in storage.
    const key = randomUUID();
    const created = await api
      .send(visitor, "post", "/events", {
        title: "Visitor's event",
        startsAt: "2027-01-10T18:00:00Z",
        endsAt: "2027-01-10T19:00:00Z",
        timeZone: "Europe/London",
      })
      .set("Idempotency-Key", key);
    expect(created.status, created.text).toBe(201);
    const launch = EventPage.parse(
      (await api.get(visitor, "/events?q=Autumn")).body,
    ).items[0];
    const detail = await api.get(visitor, `/events/${launch?.id ?? ""}`);
    const renamed = await api
      .send(visitor, "patch", `/events/${launch?.id ?? ""}`, {
        title: "Renamed by a visitor",
      })
      .set("If-Match", detail.headers.etag ?? "");
    expect(renamed.status, renamed.text).toBe(200);
    const uploadStart = await api.send(
      visitor,
      "post",
      `/events/${launch?.id ?? ""}/assets/holding-slate`,
      { contentType: "image/png", sizeBytes: png().length },
    );
    expect(uploadStart.status, uploadStart.text).toBe(201);
    const upload = AssetUpload.parse(uploadStart.body);
    await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: png(),
    });
    const completed = await api.send(
      visitor,
      "post",
      `/assets/${upload.assetId}/complete`,
    );
    expect(completed.status, completed.text).toBe(200);
    const [asset] = await database.query<{ storage_key: string }>(
      "SELECT storage_key FROM assets WHERE id = $1",
      [upload.assetId],
    );
    const storage = app.get(ObjectStorage);
    expect(await storage.stat(asset?.storage_key ?? "")).toBeDefined();
    // A file with no asset row, as one uploaded while the reset runs would
    // be, and a file of another workspace's event.
    const stray = `${eventFilesPrefix(launch?.id ?? "")}holding-slates/stray`;
    const elsewhere = `${eventFilesPrefix(realEvent.id)}holding-slates/kept`;
    for (const key of [stray, uploadKeyFor(stray), elsewhere]) {
      await put(storage, key);
    }

    const removed = await app.get(DemoSeeder).reset();

    expect(removed).toBe(SEED_TITLES.length + 1);
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
    for (const key of [
      asset?.storage_key ?? "",
      uploadKeyFor(asset?.storage_key ?? ""),
      stray,
      uploadKeyFor(stray),
    ]) {
      expect(await storage.stat(key), key).toBeUndefined();
    }
    expect(await storage.stat(elsewhere)).toBeDefined();
    // The stored response is gone too: the key now creates a new event
    // rather than replaying one that no longer exists.
    const again = await api
      .send(visitor, "post", "/events", {
        title: "Visitor's event",
        startsAt: "2027-01-10T18:00:00Z",
        endsAt: "2027-01-10T19:00:00Z",
        timeZone: "Europe/London",
      })
      .set("Idempotency-Key", key);
    expect(again.status, again.text).toBe(201);
    expect((again.body as { id: string }).id).not.toBe(
      (created.body as { id: string }).id,
    );
    // Another workspace keeps its data.
    expect(await eventTitles(api, owner)).toEqual([realEvent.title]);
  });

  it("restores the seed once when two resets run at the same moment", async () => {
    const block = await blockWrites(database.url, "events");
    const seeder = app.get(DemoSeeder);
    const resets = [seeder.reset(), seeder.reset()];
    try {
      // One reset waits to delete events, the other for the demo lock.
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }
    await Promise.all(resets);

    const rows = await database.query<{ title: string }>(
      "SELECT title FROM events WHERE workspace_id = $1 ORDER BY title",
      [DEMO_WORKSPACE.id],
    );
    expect(rows.map(({ title }) => title)).toEqual(SEED_TITLES);
  });
});

describe("demo mode, first use", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await startApp(database, true);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("creates the demo workspace once when the first visitors arrive together", async () => {
    // The first visitor holds the demo lock and waits to write the
    // workspace; the others wait for the lock.
    const block = await blockWrites(database.url, "workspaces");
    const visitors = Array.from({ length: 4 }, () =>
      Promise.resolve(demoSignIn(app)),
    );
    try {
      await block.waitForWaiters(4);
    } finally {
      await block.release();
    }
    const responses = await Promise.all(visitors);

    expect(responses.map(({ status }) => status)).toEqual([204, 204, 204, 204]);
    const workspaces = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM workspaces WHERE is_demo",
    );
    expect(workspaces[0]?.count).toBe(1);
    const events = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM events WHERE workspace_id = $1",
      [DEMO_WORKSPACE.id],
    );
    expect(events[0]?.count).toBe(SEED_TITLES.length);
  });
});

describe("demo mode switched off", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await startApp(database, false);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("answers as if the demo sign-in did not exist, and creates nothing", async () => {
    const response = await demoSignIn(app);

    expect(response.status).toBe(404);
    expect(ProblemDetails.parse(response.body).code).toBe("NOT_FOUND");
    const workspaces = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM workspaces",
    );
    expect(workspaces[0]?.count).toBe(0);
  });
});
