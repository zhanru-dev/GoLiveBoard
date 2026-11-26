import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  AccessPolicy,
  ProblemDetails,
  RunbookTask,
} from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { addTask, createEvent, memberOf } from "../testing/events.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

const problemOf = (body: unknown) => ProblemDetails.parse(body);
const Tasks = z.array(RunbookTask);
const PARALLEL_REQUESTS = 8;

describe("runbook (FR-LC-1) and access policy (FR-AD-2)", () => {
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

  const listTasks = async (session: TestSession, eventId: string) =>
    Tasks.parse(
      (await api.get(session, `/events/${eventId}/runbook-tasks`)).body,
    );

  const patchTask = (session: TestSession, task: RunbookTask, body: object) =>
    api
      .send(session, "patch", `/runbook-tasks/${task.id}`, body)
      .set("If-Match", `"${String(task.version)}"`);

  const archive = (eventId: string) =>
    database.query("UPDATE events SET status = 'ARCHIVED' WHERE id = $1", [
      eventId,
    ]);

  describe("tasks", () => {
    it("appends tasks in order and lists them for Analysts too", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(api, mailer, owner, "ANALYST");
      const event = await createEvent(api, owner);

      await addTask(api, owner, event.id, { title: "Book the venue" });
      await addTask(api, owner, event.id, {
        title: "Test the stream",
        isCritical: true,
        dueAt: "2026-12-01T17:00:00Z",
      });

      expect(await listTasks(analyst, event.id)).toMatchObject([
        { title: "Book the venue", position: 1, isCritical: false },
        {
          title: "Test the stream",
          position: 2,
          isCritical: true,
          dueAt: "2026-12-01T17:00:00.000Z",
          status: "TODO",
        },
      ]);
    });

    it("gives tasks added at the same moment distinct positions", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      const block = await blockWrites(database.url, "runbook_tasks");

      const pending = Promise.all(
        Array.from({ length: PARALLEL_REQUESTS }, (_, index) =>
          Promise.resolve(
            api.send(owner, "post", `/events/${event.id}/runbook-tasks`, {
              title: `Task ${String(index)}`,
            }),
          ),
        ),
      );
      await block.waitForWaiters(PARALLEL_REQUESTS);
      await block.release();
      await pending;

      const positions = (await listTasks(owner, event.id)).map(
        (task) => task.position,
      );
      expect(positions).toEqual(
        Array.from({ length: PARALLEL_REQUESTS }, (_, index) => index + 1),
      );
    });

    it("records who completed a task and when, and clears it on reopening", async () => {
      const owner = await api.newOwner();
      const me = await api.me(owner);
      const event = await createEvent(api, owner);
      const task = await addTask(api, owner, event.id, { title: "Rehearse" });

      const done = RunbookTask.parse(
        (await patchTask(owner, task, { status: "DONE" })).body,
      );
      expect(done).toMatchObject({
        status: "DONE",
        completedAt: clock.now().toISOString(),
        completedBy: { userId: me.user.id, name: me.user.name },
        version: 2,
      });

      const reopened = RunbookTask.parse(
        (await patchTask(owner, done, { status: "TODO" })).body,
      );
      expect(reopened).toMatchObject({
        status: "TODO",
        completedAt: null,
        completedBy: null,
      });
    });

    it("requires the current version to edit", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      const task = await addTask(api, owner, event.id, { title: "Rehearse" });
      await patchTask(owner, task, { title: "Rehearse twice" });

      const stale = await patchTask(owner, task, { title: "Stale" });
      const missing = await api.send(
        owner,
        "patch",
        `/runbook-tasks/${task.id}`,
        { title: "No header" },
      );

      expect(stale.status).toBe(412);
      expect(missing.status).toBe(428);
    });

    it("moves a task and keeps positions 1, 2, 3…", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      const [a, b, c] = [
        await addTask(api, owner, event.id, { title: "A" }),
        await addTask(api, owner, event.id, { title: "B" }),
        await addTask(api, owner, event.id, { title: "C" }),
      ];

      const first = await api.send(
        owner,
        "post",
        `/runbook-tasks/${c.id}/move`,
        {
          after: null,
        },
      );
      expect(Tasks.parse(first.body).map((t) => t.title)).toEqual([
        "C",
        "A",
        "B",
      ]);

      const moved = await api.send(
        owner,
        "post",
        `/runbook-tasks/${c.id}/move`,
        {
          after: b.id,
        },
      );
      expect(Tasks.parse(moved.body).map((t) => [t.title, t.position])).toEqual(
        [
          ["A", 1],
          ["B", 2],
          ["C", 3],
        ],
      );
      expect(a.position).toBe(1);
    });

    it("refuses to move a task after one from another event", async () => {
      const owner = await api.newOwner();
      const first = await createEvent(api, owner);
      const second = await createEvent(api, owner);
      const task = await addTask(api, owner, first.id, { title: "A" });
      const other = await addTask(api, owner, second.id, { title: "B" });

      const response = await api.send(
        owner,
        "post",
        `/runbook-tasks/${task.id}/move`,
        { after: other.id },
      );

      expect(response.status).toBe(400);
      expect(problemOf(response.body).errors).toEqual([
        expect.objectContaining({ path: "after" }),
      ]);
    });

    it("deletes a task and closes the gap", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      await addTask(api, owner, event.id, { title: "A" });
      const b = await addTask(api, owner, event.id, { title: "B" });
      await addTask(api, owner, event.id, { title: "C" });

      const response = await api
        .send(owner, "delete", `/runbook-tasks/${b.id}`)
        .set("If-Match", '"1"');

      expect(response.status).toBe(204);
      expect(
        (await listTasks(owner, event.id)).map((t) => [t.title, t.position]),
      ).toEqual([
        ["A", 1],
        ["C", 2],
      ]);
    });

    it("refuses an owner from outside the workspace", async () => {
      const owner = await api.newOwner();
      const stranger = await api.me(await api.newOwner("stranger"));
      const event = await createEvent(api, owner);

      const response = await api.send(
        owner,
        "post",
        `/events/${event.id}/runbook-tasks`,
        { title: "A", ownerUserId: stranger.user.id },
      );

      expect(response.status).toBe(400);
    });

    it("refuses every runbook write once the event is archived", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      const task = await addTask(api, owner, event.id, { title: "A" });
      await archive(event.id);

      const responses = [
        await api.send(owner, "post", `/events/${event.id}/runbook-tasks`, {
          title: "B",
        }),
        await patchTask(owner, task, { status: "DONE" }),
        await api.send(owner, "post", `/runbook-tasks/${task.id}/move`, {
          after: null,
        }),
        await api
          .send(owner, "delete", `/runbook-tasks/${task.id}`)
          .set("If-Match", '"1"'),
      ];

      for (const response of responses) {
        expect(response.status).toBe(409);
        expect(problemOf(response.body).code).toBe("EVENT_ARCHIVED");
      }
    });

    it("refuses Analysts and hides other workspaces' tasks", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(api, mailer, owner, "ANALYST");
      const stranger = await api.newOwner("stranger");
      const event = await createEvent(api, owner);
      const task = await addTask(api, owner, event.id, { title: "A" });

      expect(
        (
          await api.send(analyst, "post", `/events/${event.id}/runbook-tasks`, {
            title: "B",
          })
        ).status,
      ).toBe(403);
      expect((await patchTask(analyst, task, { title: "B" })).status).toBe(403);
      expect(
        (await api.get(stranger, `/events/${event.id}/runbook-tasks`)).status,
      ).toBe(404);
      expect(
        (
          await api.send(
            stranger,
            "post",
            `/events/${event.id}/runbook-tasks`,
            {
              title: "Planted",
            },
          )
        ).status,
      ).toBe(404);
      const [planted] = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM runbook_tasks WHERE event_id = $1",
        [event.id],
      );
      expect(planted?.count).toBe(1);
      expect((await patchTask(stranger, task, { title: "B" })).status).toBe(
        404,
      );
      expect(
        (
          await api.send(stranger, "post", `/runbook-tasks/${task.id}/move`, {
            after: null,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await api
            .send(stranger, "delete", `/runbook-tasks/${task.id}`)
            .set("If-Match", '"1"')
        ).status,
      ).toBe(404);
    });
  });

  describe("access policy", () => {
    const put = (
      session: TestSession,
      eventId: string,
      body: object,
      ifMatch?: string,
    ) => {
      const call = api.send(
        session,
        "put",
        `/events/${eventId}/access-policy`,
        body,
      );
      return ifMatch === undefined ? call : call.set("If-Match", ifMatch);
    };
    const domainOnly = {
      mode: "EMAIL_DOMAIN",
      allowedDomains: ["Example.com"],
      privacyNoticeVersion: "2026-11",
    };

    it("is missing until set, then created without If-Match", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);

      expect(
        (await api.get(owner, `/events/${event.id}/access-policy`)).status,
      ).toBe(404);
      const created = await put(owner, event.id, domainOnly);

      expect(created.status).toBe(200);
      expect(created.headers.etag).toBe('"1"');
      expect(AccessPolicy.parse(created.body)).toMatchObject({
        mode: "EMAIL_DOMAIN",
        allowedDomains: ["example.com"],
        version: 1,
      });
    });

    it("requires the current version to replace it", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      await put(owner, event.id, domainOnly);
      const publicPolicy = { mode: "PUBLIC", privacyNoticeVersion: "2026-12" };

      expect((await put(owner, event.id, publicPolicy)).status).toBe(428);
      expect((await put(owner, event.id, publicPolicy, '"7"')).status).toBe(
        412,
      );
      const replaced = await put(owner, event.id, publicPolicy, '"1"');
      expect(replaced.status).toBe(200);
      expect(AccessPolicy.parse(replaced.body)).toMatchObject({
        mode: "PUBLIC",
        allowedDomains: [],
        version: 2,
      });
    });

    it("refuses If-Match on the first PUT", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);

      expect((await put(owner, event.id, domainOnly, '"1"')).status).toBe(412);
    });

    const publicOnly = {
      mode: "PUBLIC",
      allowedDomains: [],
      privacyNoticeVersion: "2026-12",
    };
    /** Alternating shapes, so a mixed row would show. */
    const shapes = [domainOnly, publicOnly, domainOnly, publicOnly];

    /** Whether the stored mode and domains agree (docs/03 §5). */
    async function storedShapeIsConsistent(eventId: string) {
      const [row] = await database.query<{ consistent: boolean }>(
        `SELECT (mode = 'EMAIL_DOMAIN') = (cardinality(allowed_domains) > 0)
           AS consistent
         FROM access_policies WHERE event_id = $1`,
        [eventId],
      );
      return row?.consistent;
    }

    it("lets one of several simultaneous first PUTs create it, whole", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      const block = await blockWrites(database.url, "access_policies");

      const pending = Promise.all(
        shapes.map((body) => Promise.resolve(put(owner, event.id, body))),
      );
      // One holds the event lock at its insert; the rest wait for the lock.
      await block.waitForWaiters(shapes.length);
      await block.release();
      const responses = await pending;

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 428, 428, 428,
      ]);
      expect(await storedShapeIsConsistent(event.id)).toBe(true);
    });

    it("lets one of several simultaneous replacements win, whole", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      expect((await put(owner, event.id, domainOnly)).status).toBe(200);
      const block = await blockWrites(database.url, "access_policies");

      const pending = Promise.all(
        shapes.map((body) =>
          Promise.resolve(put(owner, event.id, body, '"1"')),
        ),
      );
      await block.waitForWaiters(shapes.length);
      await block.release();
      const responses = await pending;

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 412, 412, 412,
      ]);
      expect(await storedShapeIsConsistent(event.id)).toBe(true);
    });

    it("is refused by the database when mode and domains disagree", async () => {
      const owner = await api.newOwner();
      const event = await createEvent(api, owner);
      await put(owner, event.id, domainOnly);

      await expect(
        database.query(
          "UPDATE access_policies SET mode = 'PUBLIC' WHERE event_id = $1",
          [event.id],
        ),
      ).rejects.toThrow(/access_policies_domains_match_mode/);
    });

    it("rejects domains for PUBLIC and refuses Analysts, archived events and other workspaces", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(api, mailer, owner, "ANALYST");
      const stranger = await api.newOwner("stranger");
      const event = await createEvent(api, owner);

      expect(
        (
          await put(owner, event.id, {
            mode: "PUBLIC",
            allowedDomains: ["example.com"],
            privacyNoticeVersion: "v1",
          })
        ).status,
      ).toBe(400);
      expect((await put(analyst, event.id, domainOnly)).status).toBe(403);
      expect((await put(stranger, event.id, domainOnly)).status).toBe(404);
      await put(owner, event.id, domainOnly);
      expect(
        (await api.get(stranger, `/events/${event.id}/access-policy`)).status,
      ).toBe(404);
      expect(
        (await api.get(analyst, `/events/${event.id}/access-policy`)).status,
      ).toBe(200);
      await archive(event.id);
      expect((await put(owner, event.id, domainOnly, '"1"')).status).toBe(409);
    });
  });
});
