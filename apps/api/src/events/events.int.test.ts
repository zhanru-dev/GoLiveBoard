import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { EventDetail, ProblemDetails } from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiClient,
  TEST_PASSWORD,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import { IDEMPOTENCY_TTL_MS } from "../idempotency/idempotency.js";

const problemOf = (body: unknown) => ProblemDetails.parse(body);

/** Enough simultaneous requests to overlap, within the pool of 10 connections. */
const PARALLEL_REQUESTS = 8;

const launch = {
  title: "Product launch",
  description: "The autumn release.",
  startsAt: "2026-12-01T18:00:00Z",
  endsAt: "2026-12-01T19:30:00Z",
  timeZone: "Europe/London",
};

describe("events (FR-EV-1, FR-EV-4)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();
  const clock = new TestClock();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.url },
      mailer,
      clock,
    });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  /** A member of the owner's workspace with the given role, signed in. */
  async function memberOf(owner: TestSession, role: "MANAGER" | "ANALYST") {
    const email = uniqueEmail(role.toLowerCase());
    await api.send(owner, "post", "/workspace/invitations", { email, role });
    const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
    await api.post("/team-invitations/accept", {
      token,
      name: "Grace Hopper",
      password: TEST_PASSWORD,
    });
    return api.session(email);
  }

  async function createEvent(session: TestSession, body: object = launch) {
    const response = await api.send(session, "post", "/events", body);
    expect(response.status).toBe(201);
    return EventDetail.parse(response.body);
  }

  function patch(
    session: TestSession,
    eventId: string,
    body: object,
    ifMatch?: string,
  ) {
    const call = api.send(session, "patch", `/events/${eventId}`, body);
    return ifMatch === undefined ? call : call.set("If-Match", ifMatch);
  }

  describe("create", () => {
    it("creates a draft with a slug, a Location, an ETag and an audit entry for the request", async () => {
      const owner = await api.newOwner();

      const response = await api.send(owner, "post", "/events", launch);

      expect(response.status).toBe(201);
      const event = EventDetail.parse(response.body);
      expect(event).toMatchObject({
        ...launch,
        startsAt: "2026-12-01T18:00:00.000Z",
        endsAt: "2026-12-01T19:30:00.000Z",
        status: "DRAFT",
        version: 1,
        owner: null,
        expectedAttendance: null,
      });
      expect(event.slug).toMatch(/^product-launch-[a-z2-9]{10}$/);
      expect(response.headers.location).toBe(`/api/v1/events/${event.id}`);
      expect(response.headers.etag).toBe('"1"');
      const audit = await database.query<{
        action: string;
        actor_user_id: string;
        request_id: string | null;
      }>(
        "SELECT action, actor_user_id, request_id FROM audit_entries WHERE target_id = $1",
        [event.id],
      );
      expect(audit).toEqual([
        {
          action: "event.created",
          actor_user_id: (await api.me(owner)).user.id,
          request_id: response.headers["x-request-id"],
        },
      ]);
    });

    it("assigns an owner who is a member of the workspace", async () => {
      const owner = await api.newOwner();
      const me = await api.me(owner);

      const event = await createEvent(owner, {
        ...launch,
        ownerUserId: me.user.id,
      });

      expect(event.owner).toEqual({ userId: me.user.id, name: me.user.name });
    });

    it("refuses an owner from another workspace", async () => {
      const owner = await api.newOwner();
      const stranger = await api.me(await api.newOwner("stranger"));

      const response = await api.send(owner, "post", "/events", {
        ...launch,
        ownerUserId: stranger.user.id,
      });

      expect(response.status).toBe(400);
      expect(problemOf(response.body).errors).toEqual([
        expect.objectContaining({ path: "ownerUserId" }),
      ]);
    });

    it("rejects an end that is not after the start", async () => {
      const owner = await api.newOwner();

      const response = await api.send(owner, "post", "/events", {
        ...launch,
        endsAt: launch.startsAt,
      });

      expect(response.status).toBe(400);
      expect(problemOf(response.body).errors).toEqual([
        expect.objectContaining({
          path: "endsAt",
          message: "End must be after start.",
        }),
      ]);
    });

    it("lets a Manager create but not an Analyst", async () => {
      const owner = await api.newOwner();
      const manager = await memberOf(owner, "MANAGER");
      const analyst = await memberOf(owner, "ANALYST");

      expect((await api.send(manager, "post", "/events", launch)).status).toBe(
        201,
      );
      const refused = await api.send(analyst, "post", "/events", launch);
      expect(refused.status).toBe(403);
      expect(problemOf(refused.body).code).toBe("FORBIDDEN");
    });

    it("refuses a request without a session", async () => {
      expect((await api.post("/events", launch)).status).toBe(401);
    });
  });

  describe("idempotent create (Idempotency-Key)", () => {
    const create = (session: TestSession, key: string, body: object = launch) =>
      api.send(session, "post", "/events", body).set("Idempotency-Key", key);

    async function eventCount(session: TestSession): Promise<number> {
      const workspaceId = (await api.me(session)).activeWorkspace.workspaceId;
      const [row] = await database.query<{ count: string }>(
        "SELECT count(*) FROM events WHERE workspace_id = $1",
        [workspaceId],
      );
      return Number(row?.count);
    }

    it("returns the original response to a retry", async () => {
      const owner = await api.newOwner();
      const key = randomUUID();

      const first = await create(owner, key);
      const retry = await create(owner, key);

      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers.location).toBe(first.headers.location);
      expect(await eventCount(owner)).toBe(1);
    });

    it("creates exactly one event when the same key arrives many times at once", async () => {
      const owner = await api.newOwner();
      const key = randomUUID();
      const block = await blockWrites(database.url, "events");

      const pending = Promise.all(
        Array.from({ length: PARALLEL_REQUESTS }, () =>
          Promise.resolve(create(owner, key)),
        ),
      );
      // Every request has looked for a stored response and is waiting:
      // without serialisation, all of them would now insert an event.
      await block.waitForWaiters(PARALLEL_REQUESTS);
      await block.release();
      const responses = await pending;

      expect(responses.map((response) => response.status)).toEqual(
        Array.from({ length: PARALLEL_REQUESTS }, () => 201),
      );
      const ids = new Set(
        responses.map((response) => EventDetail.parse(response.body).id),
      );
      expect(ids.size).toBe(1);
      expect(await eventCount(owner)).toBe(1);
    });

    it("refuses the same key with a different body", async () => {
      const owner = await api.newOwner();
      const key = randomUUID();
      await create(owner, key);

      const response = await create(owner, key, { ...launch, title: "Other" });

      expect(response.status).toBe(422);
      expect(problemOf(response.body).code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("keeps keys apart between users", async () => {
      const owner = await api.newOwner();
      const manager = await memberOf(owner, "MANAGER");
      const key = randomUUID();

      const first = EventDetail.parse((await create(owner, key)).body);
      const second = EventDetail.parse((await create(manager, key)).body);

      expect(second.id).not.toBe(first.id);
    });

    it("frees a key after 24 hours", async () => {
      const owner = await api.newOwner();
      const key = randomUUID();
      const first = EventDetail.parse((await create(owner, key)).body);

      clock.advance(IDEMPOTENCY_TTL_MS);
      // The access token expired too; sign in again.
      const later = await create(await api.session(owner.email), key, {
        ...launch,
        title: "Next year",
      });

      expect(later.status).toBe(201);
      expect(EventDetail.parse(later.body).id).not.toBe(first.id);
    });

    it("rejects a key that is not a UUID", async () => {
      const owner = await api.newOwner();

      const response = await create(owner, "retry-1");

      expect(response.status).toBe(400);
      expect(problemOf(response.body).errors).toEqual([
        expect.objectContaining({ path: "Idempotency-Key" }),
      ]);
    });
  });

  describe("read", () => {
    it("returns the event with its version as the ETag, also to Analysts", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(owner, "ANALYST");
      const event = await createEvent(owner);

      const response = await api.get(analyst, `/events/${event.id}`);

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"1"');
      expect(EventDetail.parse(response.body)).toEqual(event);
    });

    it("answers 404 for another workspace's event", async () => {
      const event = await createEvent(await api.newOwner());
      const stranger = await api.newOwner("stranger");

      const response = await api.get(stranger, `/events/${event.id}`);

      expect(response.status).toBe(404);
      expect(problemOf(response.body).code).toBe("NOT_FOUND");
    });

    it("rejects an ID that is not a UUID", async () => {
      const owner = await api.newOwner();

      expect((await api.get(owner, "/events/not-an-id")).status).toBe(400);
    });
  });

  describe("update", () => {
    it("applies a change from the current version and returns the next ETag", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);

      const response = await patch(
        owner,
        event.id,
        { title: "Winter launch", expectedAttendance: 300 },
        '"1"',
      );

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"2"');
      expect(EventDetail.parse(response.body)).toMatchObject({
        title: "Winter launch",
        expectedAttendance: 300,
        slug: event.slug,
        version: 2,
      });
    });

    it("audits only the fields that changed, before and after", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);

      await patch(
        owner,
        event.id,
        { title: "Winter launch", timeZone: launch.timeZone },
        '"1"',
      );

      const [entry] = await database.query<{ before: object; after: object }>(
        "SELECT before, after FROM audit_entries WHERE target_id = $1 AND action = 'event.updated'",
        [event.id],
      );
      expect(entry).toEqual({
        before: { title: "Product launch" },
        after: { title: "Winter launch" },
      });
    });

    it("requires If-Match", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);

      const response = await patch(owner, event.id, { title: "No header" });

      expect(response.status).toBe(428);
      expect(problemOf(response.body).code).toBe("PRECONDITION_REQUIRED");
    });

    it("rejects a change based on an old version", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);
      await patch(owner, event.id, { title: "First edit" }, '"1"');

      const response = await patch(owner, event.id, { title: "Stale" }, '"1"');

      expect(response.status).toBe(412);
      expect(problemOf(response.body).code).toBe("VERSION_CONFLICT");
      expect(
        EventDetail.parse((await api.get(owner, `/events/${event.id}`)).body)
          .title,
      ).toBe("First edit");
    });

    it("lets exactly one of several edits from the same version win", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);
      const block = await blockWrites(database.url, "events");

      const pending = Promise.all(
        Array.from({ length: PARALLEL_REQUESTS }, (_, index) =>
          Promise.resolve(
            patch(owner, event.id, { title: `Edit ${String(index)}` }, '"1"'),
          ),
        ),
      );
      // All of them have read version 1 and passed the version check.
      await block.waitForWaiters(PARALLEL_REQUESTS);
      await block.release();
      const responses = await pending;

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([
        200,
        ...Array.from({ length: PARALLEL_REQUESTS - 1 }, () => 412),
      ]);
      const stored = EventDetail.parse(
        (await api.get(owner, `/events/${event.id}`)).body,
      );
      expect(stored.version).toBe(2);
    });

    it("keeps the end after the start when a new start and a new end race", async () => {
      const owner = await api.newOwner();
      // 18:00–19:30. Each change is valid on its own; together the event
      // would start at 19:00 and end at 18:30.
      const event = await createEvent(owner);
      const block = await blockWrites(database.url, "events");

      const pending = Promise.all([
        Promise.resolve(
          patch(owner, event.id, { startsAt: "2026-12-01T19:00:00Z" }, '"1"'),
        ),
        Promise.resolve(
          patch(owner, event.id, { endsAt: "2026-12-01T18:30:00Z" }, '"1"'),
        ),
      ]);
      // Both have checked their change against the stored times.
      await block.waitForWaiters(2);
      await block.release();
      const responses = await pending;

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 412,
      ]);
      const [stored] = await database.query<{ ordered: boolean }>(
        "SELECT ends_at > starts_at AS ordered FROM events WHERE id = $1",
        [event.id],
      );
      expect(stored?.ordered).toBe(true);
    });

    it("checks the end against the stored start", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);

      const response = await patch(
        owner,
        event.id,
        { endsAt: "2026-12-01T17:00:00Z" },
        '"1"',
      );

      expect(response.status).toBe(400);
      expect(problemOf(response.body).errors).toEqual([
        expect.objectContaining({ path: "endsAt" }),
      ]);
    });

    it("clears the owner", async () => {
      const owner = await api.newOwner();
      const me = await api.me(owner);
      const event = await createEvent(owner, {
        ...launch,
        ownerUserId: me.user.id,
      });

      const response = await patch(
        owner,
        event.id,
        { ownerUserId: null },
        '"1"',
      );

      expect(EventDetail.parse(response.body).owner).toBeNull();
    });

    it("refuses every change to an archived event", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(owner);
      await database.query(
        "UPDATE events SET status = 'ARCHIVED' WHERE id = $1",
        [event.id],
      );

      const response = await patch(
        owner,
        event.id,
        { title: "Too late" },
        '"1"',
      );

      expect(response.status).toBe(409);
      expect(problemOf(response.body).code).toBe("EVENT_ARCHIVED");
    });

    it("answers 404 for another workspace's event", async () => {
      const event = await createEvent(await api.newOwner());
      const stranger = await api.newOwner("stranger");

      const response = await patch(
        stranger,
        event.id,
        { title: "Mine" },
        '"1"',
      );

      expect(response.status).toBe(404);
    });

    it("refuses Analysts", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(owner, "ANALYST");
      const event = await createEvent(owner);

      expect(
        (await patch(analyst, event.id, { title: "Nope" }, '"1"')).status,
      ).toBe(403);
    });
  });
});
