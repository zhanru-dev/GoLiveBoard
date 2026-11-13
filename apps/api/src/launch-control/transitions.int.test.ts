import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  EventDetail,
  EventTransitionedPayload,
  ProblemDetails,
  Readiness,
} from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { createEvent, memberOf, prepareForLaunch } from "../testing/events.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

const problemOf = (body: unknown) => ProblemDetails.parse(body);

/** Enough simultaneous requests to overlap, within the pool of 10 connections. */
const PARALLEL_REQUESTS = 8;

describe("event transitions (FR-EV-2, FR-LC-3)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();
  const clock = new TestClock(new Date("2026-12-01T17:30:00.000Z"));

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

  const transition = (session: TestSession, eventId: string, to: string) =>
    api.send(session, "post", `/events/${eventId}/transitions`, { to });

  async function moveTo(session: TestSession, eventId: string, to: string) {
    const response = await transition(session, eventId, to);
    expect(response.status, response.text).toBe(200);
    return EventDetail.parse(response.body);
  }

  async function statusOf(eventId: string): Promise<string | undefined> {
    const [row] = await database.query<{ status: string }>(
      "SELECT status FROM events WHERE id = $1",
      [eventId],
    );
    return row?.status;
  }

  async function outboxFor(eventId: string) {
    const rows = await database.query<{ type: string; payload: unknown }>(
      "SELECT type, payload FROM outbox_messages WHERE payload->>'eventId' = $1 ORDER BY created_at, id",
      [eventId],
    );
    return rows.map((row) => ({
      type: row.type,
      payload: EventTransitionedPayload.parse(row.payload),
    }));
  }

  /** An event in CONFIGURING with every hard blocker removed. */
  async function readyToGo(owner: TestSession) {
    const event = await createEvent(api, owner);
    await moveTo(owner, event.id, "CONFIGURING");
    const task = await prepareForLaunch(
      api,
      database,
      owner,
      event.id,
      clock.now(),
    );
    return { event, task };
  }

  it("moves a draft to CONFIGURING, recording an audit entry and an outbox message", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await transition(owner, event.id, "CONFIGURING");

    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(EventDetail.parse(response.body)).toMatchObject({
      status: "CONFIGURING",
      version: 2,
    });
    expect(await outboxFor(event.id)).toEqual([
      {
        type: "event.transitioned",
        payload: {
          eventId: event.id,
          from: "DRAFT",
          to: "CONFIGURING",
          occurredAt: clock.now().toISOString(),
        },
      },
    ]);
    const audit = await database.query<{ before: object; after: object }>(
      "SELECT before, after FROM audit_entries WHERE target_id = $1 AND action = 'event.transitioned'",
      [event.id],
    );
    expect(audit).toEqual([
      { before: { status: "DRAFT" }, after: { status: "CONFIGURING" } },
    ]);
  });

  it("refuses a move the lifecycle does not allow, listing the allowed ones", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await transition(owner, event.id, "LIVE");

    expect(response.status).toBe(409);
    expect(problemOf(response.body)).toMatchObject({
      code: "ILLEGAL_TRANSITION",
      from: "DRAFT",
      to: "LIVE",
      allowed: ["CONFIGURING", "CANCELLED"],
    });
  });

  it("refuses READY while hard blockers remain, listing them, and changes nothing", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    await moveTo(owner, event.id, "CONFIGURING");

    const response = await transition(owner, event.id, "READY");

    expect(response.status).toBe(409);
    const problem = problemOf(response.body);
    expect(problem.code).toBe("EVENT_HAS_BLOCKERS");
    expect(problem.blockers).toEqual([
      {
        criterion: "ACCESS_POLICY",
        evidence: "No access policy has been set.",
      },
      {
        criterion: "STREAM_REACHABLE",
        evidence: "No stream URL has been set.",
      },
      {
        criterion: "HOLDING_SLATE",
        evidence: "No holding slate has been uploaded.",
      },
    ]);
    expect(await statusOf(event.id)).toBe("CONFIGURING");
    expect(await outboxFor(event.id)).toHaveLength(1);
  });

  it("reaches READY and LIVE once nothing blocks, storing the readiness result", async () => {
    const owner = await api.newOwner();
    const { event } = await readyToGo(owner);

    await moveTo(owner, event.id, "READY");
    const live = await moveTo(owner, event.id, "LIVE");

    expect(live.status).toBe("LIVE");
    const [entry] = await database.query<{ after: object }>(
      "SELECT after FROM audit_entries WHERE target_id = $1 AND after->>'status' = 'LIVE'",
      [event.id],
    );
    expect(entry?.after).toEqual({
      status: "LIVE",
      readiness: { ruleVersion: 1, score: 95 },
    });
    expect((await outboxFor(event.id)).map((m) => m.payload.to)).toEqual([
      "CONFIGURING",
      "READY",
      "LIVE",
    ]);
  });

  it("re-checks blockers on LIVE: a stream check that has gone stale blocks it", async () => {
    const owner = await api.newOwner();
    const { event } = await readyToGo(owner);
    await moveTo(owner, event.id, "READY");

    clock.advance(6 * 60_000);
    const response = await transition(owner, event.id, "LIVE");

    expect(response.status).toBe(409);
    expect(problemOf(response.body).blockers).toEqual([
      expect.objectContaining({ criterion: "STREAM_REACHABLE" }),
    ]);
  });

  it("gives one success and only conflicts to many simultaneous go-live requests", async () => {
    const owner = await api.newOwner();
    const { event } = await readyToGo(owner);
    await moveTo(owner, event.id, "READY");
    const block = await blockWrites(database.url, "events");

    const pending = Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () =>
        Promise.resolve(transition(owner, event.id, "LIVE")),
      ),
    );
    // One request holds the event lock and waits to write; the rest wait for
    // the lock. Without it, all of them would have passed their checks.
    await block.waitForWaiters(PARALLEL_REQUESTS);
    await block.release();
    const responses = await pending;

    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      ...Array.from({ length: PARALLEL_REQUESTS - 1 }, () => 409),
    ]);
    const live = (await outboxFor(event.id)).filter(
      (message) => message.payload.to === "LIVE",
    );
    expect(live).toHaveLength(1);
  });

  it("cannot go live past a critical task reopened at the same moment", async () => {
    const owner = await api.newOwner();
    const { event, task } = await readyToGo(owner);
    await moveTo(owner, event.id, "READY");
    const block = await blockWrites(database.url, "runbook_tasks");

    // The reopen locks the event, then waits to write the task…
    const reopen = Promise.resolve(
      api
        .send(owner, "patch", `/runbook-tasks/${task.id}`, { status: "TODO" })
        .set("If-Match", `"${String(task.version)}"`),
    );
    await block.waitForWaiters(1);
    // …so go-live must wait for the event lock instead of judging readiness
    // from the runbook as it was before the reopen commits.
    const goLive = Promise.resolve(transition(owner, event.id, "LIVE"));
    await block.waitForWaiters(2);
    await block.release();

    expect((await reopen).status).toBe(200);
    const refused = await goLive;
    expect(refused.status).toBe(409);
    expect(problemOf(refused.body).blockers).toEqual([
      {
        criterion: "CRITICAL_TASKS_DONE",
        evidence: "1 of 1 critical tasks are still open.",
      },
    ]);
    expect(await statusOf(event.id)).toBe("READY");
  });

  it.each([
    ["READY", "CANCELLED", 200],
    ["LIVE", "CANCELLED", 409],
    ["CANCELLED", "ARCHIVED", 200],
    ["ARCHIVED", "DRAFT", 409],
  ])("from %s to %s answers %s", async (from, to, status) => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    await database.query("UPDATE events SET status = $2 WHERE id = $1", [
      event.id,
      from,
    ]);

    expect((await transition(owner, event.id, to)).status).toBe(status);
  });

  it("refuses Analysts and hides other workspaces' events", async () => {
    const owner = await api.newOwner();
    const analyst = await memberOf(api, mailer, owner, "ANALYST");
    const event = await createEvent(api, owner);
    const stranger = await api.newOwner("stranger");

    expect((await transition(analyst, event.id, "CONFIGURING")).status).toBe(
      403,
    );
    expect((await transition(stranger, event.id, "CONFIGURING")).status).toBe(
      404,
    );
    expect(await statusOf(event.id)).toBe("DRAFT");
  });

  describe("readiness (FR-LC-2)", () => {
    it("reports score, criteria, blockers and next actions, also to Analysts", async () => {
      const owner = await api.newOwner();
      const analyst = await memberOf(api, mailer, owner, "ANALYST");
      const event = await createEvent(api, owner);

      const response = await api.get(analyst, `/events/${event.id}/readiness`);

      expect(response.status).toBe(200);
      const readiness = Readiness.parse(response.body);
      expect(readiness).toMatchObject({
        ruleVersion: 1,
        assessedAt: clock.now().toISOString(),
        // No critical tasks to finish (25) and a description (5).
        score: 30,
      });
      expect(readiness.blockers.map((b) => b.criterion)).toEqual([
        "ACCESS_POLICY",
        "STREAM_REACHABLE",
        "HOLDING_SLATE",
      ]);
      expect(readiness.nextActions[0]?.section).toBe("STREAM");
    });

    it("rises as blockers are removed", async () => {
      const owner = await api.newOwner();
      const { event } = await readyToGo(owner);

      const readiness = Readiness.parse(
        (await api.get(owner, `/events/${event.id}/readiness`)).body,
      );

      expect(readiness.blockers).toEqual([]);
      // Everything but an owner (5 points).
      expect(readiness.score).toBe(95);
    });

    it("hides other workspaces' events", async () => {
      const event = await createEvent(api, await api.newOwner());
      const stranger = await api.newOwner("stranger");

      expect(
        (await api.get(stranger, `/events/${event.id}/readiness`)).status,
      ).toBe(404);
    });
  });
});
