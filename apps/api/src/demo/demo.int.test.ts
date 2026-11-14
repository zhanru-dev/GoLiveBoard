import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { AssetUpload, EventPage, ProblemDetails } from "@opspilot/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { eventFilesPrefix, uploadKeyFor } from "../assets/assets.service.js";
import { RATE_LIMITS } from "../rate-limit/rate-limiter.js";
import { VALKEY_CLIENT } from "../valkey/valkey.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { setCookies } from "../testing/cookies.js";
import {
  blockWrites,
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { createEvent } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "./demo-accounts.js";
import { DemoSeeder } from "./demo-seeder.js";
import {
  DEMO_ASSET_LIMIT,
  DEMO_EVENT_LIMIT,
  DEMO_SESSION_LIMIT,
} from "./demo-workspace.js";

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

/** A valid new event. */
const newEvent = (title: string) => ({
  title,
  startsAt: "2027-01-10T18:00:00Z",
  endsAt: "2027-01-10T19:00:00Z",
  timeZone: "Europe/London",
});

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

  it("finishes a reset after a visitor's edit that holds the event, and leaves only the seed", async () => {
    const visitor = await demoSession(app);
    const launch = EventPage.parse(
      (await api.get(visitor, "/events?q=Autumn")).body,
    ).items[0];
    const detail = await api.get(visitor, `/events/${launch?.id ?? ""}`);
    const block = await blockWrites(database.url, "events");
    // The edit locks the event row and waits at its UPDATE; the reset then
    // waits for that row (or for the table) to delete it.
    const edit = Promise.resolve(
      api
        .send(visitor, "patch", `/events/${launch?.id ?? ""}`, {
          title: "Edited during the reset",
        })
        .set("If-Match", detail.headers.etag ?? ""),
    );
    await block.waitForWaiters(1);
    const reset = app.get(DemoSeeder).reset();
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    expect((await edit).status).toBe(200);
    await reset;
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
  });

  it("deletes an event whose create was still in flight when the reset began", async () => {
    const visitor = await demoSession(app);
    const seeder = app.get(DemoSeeder);
    await seeder.reset();
    const block = await blockWrites(database.url, "events");
    // The create holds the demo lock and waits to insert its event...
    const create = Promise.resolve(
      api.send(visitor, "post", "/events", newEvent("Created as reset began")),
    );
    await block.waitForWaiters(1);
    // ...so the reset waits for it to commit, then deletes its event.
    const reset = seeder.reset();
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    expect((await create).status).toBe(201);
    await reset;
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
  });

  it("keeps an event created while the reset runs: the create waits and commits after it", async () => {
    const visitor = await demoSession(app);
    const seeder = app.get(DemoSeeder);
    // The reset has deleted the events and waits to delete invitations...
    const block = await blockWrites(database.url, "team_invitations");
    const reset = seeder.reset();
    await block.waitForWaiters(1);
    // ...while a create waits for the demo lock it holds.
    const create = Promise.resolve(
      api.send(visitor, "post", "/events", newEvent("Created after the reset")),
    );
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    await reset;
    expect((await create).status).toBe(201);
    expect(await eventTitles(api, visitor)).toEqual(
      [...SEED_TITLES, "Created after the reset"].sort(),
    );
  });

  /** The session's cookies, as a test session. */
  function sessionFrom(response: request.Response): TestSession {
    const cookies = setCookies(response);
    return {
      email: DEMO_PEOPLE.manager.email,
      access: cookies.get(ACCESS_COOKIE)?.value ?? "",
      refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
    };
  }

  it("signs a visitor in while a reset restores the accounts, and the session works after it", async () => {
    const seeder = app.get(DemoSeeder);
    // The reset restores the owner and the visitor (their rows stay locked
    // until it commits), then waits for the analyst's row...
    const block = await holdLock(
      database.url,
      "SELECT id FROM users WHERE id = $1 FOR SHARE",
      [DEMO_PEOPLE.analyst.id],
    );
    const reset = seeder.reset();
    await block.waitForWaiters(1);
    // ...so the sign-in waits to check the visitor's account, and then
    // finds it as the reset left it.
    const signIn = Promise.resolve(demoSignIn(app));
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    const response = await signIn;
    expect(response.status, response.text).toBe(204);
    await reset;
    const visitor = sessionFrom(response);
    expect((await api.me(visitor)).activeWorkspace.workspaceId).toBe(
      DEMO_WORKSPACE.id,
    );
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
  });

  it("keeps a session whose sign-in was in flight when the reset began", async () => {
    const seeder = app.get(DemoSeeder);
    // The sign-in has checked the visitor's account (and holds it) and
    // waits to store its session...
    const block = await blockWrites(database.url, "sessions");
    const signIn = Promise.resolve(demoSignIn(app));
    await block.waitForWaiters(1);
    // ...so the reset waits to restore that account.
    const reset = seeder.reset();
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    const response = await signIn;
    expect(response.status, response.text).toBe(204);
    await reset;
    const visitor = sessionFrom(response);
    expect((await api.me(visitor)).activeWorkspace.workspaceId).toBe(
      DEMO_WORKSPACE.id,
    );
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
  });

  it("finishes a reset while a visitor completes a slate of an event it deletes, without a deadlock", async () => {
    const visitor = await demoSession(app);
    const seeder = app.get(DemoSeeder);
    await seeder.reset();
    const launch = EventPage.parse(
      (await api.get(visitor, "/events?q=Autumn")).body,
    ).items[0];
    const started = await api.send(
      visitor,
      "post",
      `/events/${launch?.id ?? ""}/assets/holding-slate`,
      { contentType: "image/png", sizeBytes: png().length },
    );
    expect(started.status, started.text).toBe(201);
    const { assetId } = AssetUpload.parse(started.body);
    // The reset holds the event it deletes and waits to delete its asset...
    const block = await blockWrites(database.url, "assets");
    const reset = seeder.reset();
    await block.waitForWaiters(1);
    // ...while the completion waits for the event, holding nothing the
    // reset needs.
    const completion = Promise.resolve(
      api.send(visitor, "post", `/assets/${assetId}/complete`),
    );
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    await reset;
    const response = await completion;
    expect(response.status, response.text).toBe(404);
    expect(await eventTitles(api, visitor)).toEqual(SEED_TITLES);
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

describe("demo mode, what one visitor can make it do", () => {
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

  // Dozens of sequential requests: a slow machine needs more than the
  // default 5 seconds, without anything being wrong.
  it(
    "holds a bounded number of events, also when visitors create them at the same moment",
    { timeout: 30_000 },
    async () => {
      const visitor = await demoSession(app);
      await app.get(DemoSeeder).reset();
      for (
        let index = SEED_TITLES.length;
        index < DEMO_EVENT_LIMIT - 1;
        index += 1
      ) {
        const created = await api.send(
          visitor,
          "post",
          "/events",
          newEvent(`Filler ${String(index)}`),
        );
        expect(created.status, created.text).toBe(201);
      }
      // One slot left. The first create holds the demo lock and waits to
      // insert; the other two wait for the lock, then find the demo full.
      const block = await blockWrites(database.url, "events");
      const creates = ["One", "Two", "Three"].map((title) =>
        Promise.resolve(api.send(visitor, "post", "/events", newEvent(title))),
      );
      try {
        await block.waitForWaiters(3);
      } finally {
        await block.release();
      }
      const responses = await Promise.all(creates);

      expect(responses.map(({ status }) => status).sort()).toEqual([
        201, 403, 403,
      ]);
      for (const response of responses.filter(({ status }) => status === 403)) {
        expect(ProblemDetails.parse(response.body).code).toBe(
          "DEMO_RESTRICTED",
        );
      }
      const [row] = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM events WHERE workspace_id = $1",
        [DEMO_WORKSPACE.id],
      );
      expect(row?.count).toBe(DEMO_EVENT_LIMIT);
    },
  );

  // Dozens of sequential requests: a slow machine needs more than the
  // default 5 seconds, without anything being wrong.
  it("limits the demo workspace only", { timeout: 30_000 }, async () => {
    const owner = await api.newOwner();

    for (let index = 0; index <= DEMO_EVENT_LIMIT; index += 1) {
      const created = await api.send(
        owner,
        "post",
        "/events",
        newEvent(`Real event ${String(index)}`),
      );
      expect(created.status, created.text).toBe(201);
    }
  });

  it("hands out a bounded number of upload links, also when visitors ask at the same moment", async () => {
    const visitor = await demoSession(app);
    await app.get(DemoSeeder).reset();
    const launch = EventPage.parse(
      (await api.get(visitor, "/events?q=Autumn")).body,
    ).items[0];
    const eventId = launch?.id ?? "";
    await database.query(
      `INSERT INTO assets (event_id, kind, storage_key, content_type, size_bytes)
       SELECT $1::uuid, 'HOLDING_SLATE', 'events/' || $1::text || '/filler-' || n, 'image/png', 2048
       FROM generate_series(1, $2::int) AS n`,
      [eventId, DEMO_ASSET_LIMIT - 1],
    );
    // One slot left. The first request holds the demo lock and waits to
    // insert; the other two wait for the lock, then find the demo full.
    const block = await blockWrites(database.url, "assets");
    const uploads = [1, 2, 3].map(() =>
      Promise.resolve(
        api.send(visitor, "post", `/events/${eventId}/assets/holding-slate`, {
          contentType: "image/png",
          sizeBytes: png().length,
        }),
      ),
    );
    try {
      await block.waitForWaiters(3);
    } finally {
      await block.release();
    }
    const responses = await Promise.all(uploads);

    expect(responses.map(({ status }) => status).sort()).toEqual([
      201, 403, 403,
    ]);
    for (const response of responses.filter(({ status }) => status === 403)) {
      expect(ProblemDetails.parse(response.body).code).toBe("DEMO_RESTRICTED");
    }
    const [row] = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM assets WHERE event_id = $1",
      [eventId],
    );
    expect(row?.count).toBe(DEMO_ASSET_LIMIT);
  });

  it("limits how many changes one address makes to the demo", async () => {
    const address = newAddress();
    const visitor = await demoSession(app);
    const fromAddress = new ApiClient(app, address);
    const rule = RATE_LIMITS.demoWritesPerIp;
    // This address has already made all but one of its changes this hour.
    await app
      .get<Redis>(VALKEY_CLIENT)
      .set(
        `opspilot:rate:${rule.name}:${address}`,
        String(rule.limit - 1),
        "PX",
        rule.windowMs,
      );
    // Refused requests count too: the budget is spent before any work.
    const invalid = () =>
      fromAddress.send(visitor, "post", "/events", { title: "" });

    expect((await invalid()).status).toBe(400);
    const over = await invalid();

    expect(over.status).toBe(429);
    expect(ProblemDetails.parse(over.body).code).toBe("RATE_LIMITED");
    // Reading goes on, and other addresses go on changing the demo.
    expect((await fromAddress.get(visitor, "/events")).status).toBe(200);
    const elsewhere = new ApiClient(app, newAddress());
    expect(
      (await elsewhere.send(visitor, "post", "/events", { title: "" })).status,
    ).toBe(400);
  });

  it("lets nobody point the demo's stream checks at an address", async () => {
    const visitor = await demoSession(app);
    await app.get(DemoSeeder).reset();
    const launch = EventPage.parse(
      (await api.get(visitor, "/events?q=Autumn")).body,
    ).items[0];

    const response = await api.send(
      visitor,
      "put",
      `/events/${launch?.id ?? ""}/stream`,
      { url: "https://streams.example.com/live/index.m3u8" },
    );

    expect(response.status).toBe(403);
    expect(ProblemDetails.parse(response.body).code).toBe("DEMO_RESTRICTED");
    const rows = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM events
       WHERE workspace_id = $1 AND stream_url IS NOT NULL`,
      [DEMO_WORKSPACE.id],
    );
    expect(rows[0]?.count).toBe(0);
    const requested = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM outbox_messages
       WHERE type = 'stream.check_requested'`,
    );
    expect(requested[0]?.count).toBe(0);
  });

  it("keeps a bounded number of visitor sessions, ending the oldest and those already over", async () => {
    await demoSession(app);
    const visitorId = DEMO_PEOPLE.manager.id;
    await database.query("DELETE FROM sessions WHERE user_id = $1", [
      visitorId,
    ]);
    // A full house of live sessions, oldest first, and two that are over.
    await database.query(
      `INSERT INTO sessions
         (user_id, active_workspace_id, refresh_token_hash, refresh_expires_at, created_at)
       SELECT $1, $2, 'live-' || n, now() + interval '1 day',
              now() - interval '1 hour' + n * interval '1 millisecond'
       FROM generate_series(1, $3::int) AS n`,
      [visitorId, DEMO_WORKSPACE.id, DEMO_SESSION_LIMIT],
    );
    await database.query(
      `INSERT INTO sessions
         (user_id, active_workspace_id, refresh_token_hash, refresh_expires_at, revoked_at)
       VALUES ($1, $2, 'expired', now() - interval '1 minute', NULL),
              ($1, $2, 'revoked', now() + interval '1 day', now())`,
      [visitorId, DEMO_WORKSPACE.id],
    );

    const visitor = await demoSession(app);

    const sessions = await database.query<{ refresh_token_hash: string }>(
      "SELECT refresh_token_hash FROM sessions WHERE user_id = $1",
      [visitorId],
    );
    expect(sessions).toHaveLength(DEMO_SESSION_LIMIT);
    const hashes = new Set(sessions.map((row) => row.refresh_token_hash));
    expect(hashes.has("live-1")).toBe(false);
    expect(hashes.has("live-2")).toBe(true);
    expect(hashes.has("expired")).toBe(false);
    expect(hashes.has("revoked")).toBe(false);
    expect((await api.me(visitor)).activeWorkspace.workspaceId).toBe(
      DEMO_WORKSPACE.id,
    );
  });

  it("keeps the session limit exact when visitors sign in at the same moment", async () => {
    await demoSession(app);
    const visitorId = DEMO_PEOPLE.manager.id;
    await database.query("DELETE FROM sessions WHERE user_id = $1", [
      visitorId,
    ]);
    await database.query(
      `INSERT INTO sessions
         (user_id, active_workspace_id, refresh_token_hash, refresh_expires_at, created_at)
       SELECT $1, $2, 'live-' || n, now() + interval '1 day',
              now() - interval '1 hour' + n * interval '1 millisecond'
       FROM generate_series(1, $3::int) AS n`,
      [visitorId, DEMO_WORKSPACE.id, DEMO_SESSION_LIMIT],
    );
    // Both sign-ins store their session; the first then waits to delete the
    // oldest, which this holds, and the second waits for the first.
    const block = await holdLock(
      database.url,
      "SELECT id FROM sessions WHERE refresh_token_hash = 'live-1' FOR SHARE",
    );
    const signIns = [demoSignIn(app), demoSignIn(app)].map((call) =>
      Promise.resolve(call),
    );
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }

    expect((await Promise.all(signIns)).map(({ status }) => status)).toEqual([
      204, 204,
    ]);
    const [row] = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM sessions WHERE user_id = $1",
      [visitorId],
    );
    expect(row?.count).toBe(DEMO_SESSION_LIMIT);
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

describe("demo mode while Valkey is unreachable", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
    // The default test configuration points Valkey at a closed port.
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        DEMO_MODE: "true",
        TRUST_PROXY_HOPS: "1",
      },
      mailer: new CapturingMailer(),
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("refuses changes to the demo, which its write budget cannot count, and goes on reading", async () => {
    const api = new ApiClient(app, newAddress());
    // Signing in still works: its limit fails open.
    const visitor = await demoSession(app);

    const change = await api.send(
      visitor,
      "post",
      "/events",
      newEvent("While Valkey is down"),
    );

    expect(change.status).toBe(503);
    expect(ProblemDetails.parse(change.body).code).toBe("SERVICE_UNAVAILABLE");
    expect((await api.get(visitor, "/events")).status).toBe(200);
    const [row] = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM events WHERE title = $1",
      ["While Valkey is down"],
    );
    expect(row?.count).toBe(0);
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
