import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails, WorkspaceOverview } from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

let addressCounter = 0;
const newAddress = () => `198.18.10.${String((addressCounter += 1) % 250)}`;

describe("the workspace overview (FR-RC-4)", { timeout: 30_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
      },
      mailer,
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  /** An event that completed, with no stored report yet. */
  async function completed(workspaceId: string, startsAt: string) {
    const { eventId } = await seedEvent(database, {
      startsAt: new Date(startsAt),
      status: "COMPLETED",
      workspaceId,
    });
    await database.query(
      "UPDATE events SET completed_at = ends_at WHERE id = $1",
      [eventId],
    );
    return eventId;
  }

  async function watched(eventId: string, attendeeId: string, at: string) {
    await database.query(
      "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
      [eventId, attendeeId, new Date(at)],
    );
  }

  async function seedWorkspace(client: ApiClient, owner: TestSession) {
    const me = await client.me(owner);
    const workspaceId = me.activeWorkspace.workspaceId;
    const userId = me.user.id;

    // October: 3 registered (2 confirmed), 2 watched minute 0; 2 questions
    // (1 answered), 1 chat message, 1 incident.
    const october = await completed(workspaceId, "2026-10-15T18:00:00Z");
    const a = await seedAttendee(database, october);
    const b = await seedAttendee(database, october);
    await seedAttendee(database, october, { status: "PENDING" });
    await watched(october, a.id, "2026-10-15T18:00:00Z");
    await watched(october, b.id, "2026-10-15T18:00:00Z");
    for (const status of ["ANSWERED", "PUBLISHED"]) {
      await database.query(
        `INSERT INTO questions (event_id, author_user_id, body, status)
         VALUES ($1, $2, 'why?', $3::question_status)`,
        [october, userId, status],
      );
    }
    await database.query(
      `INSERT INTO chat_messages (event_id, sequence, author_user_id, client_message_id, body)
       VALUES ($1, 1, $2, $3, 'hello')`,
      [october, userId, randomUUID()],
    );
    await database.query(
      `INSERT INTO incidents (event_id, kind, opened_at, resolved_at)
       VALUES ($1, 'STREAM_UNREACHABLE', $2, $3)`,
      [
        october,
        new Date("2026-10-15T18:05:00Z"),
        new Date("2026-10-15T18:06:00Z"),
      ],
    );

    // November: 1 registered, who watched two minutes.
    const november = await completed(workspaceId, "2026-11-02T18:00:00Z");
    const c = await seedAttendee(database, november);
    await watched(november, c.id, "2026-11-02T18:00:00Z");
    await watched(november, c.id, "2026-11-02T18:01:00Z");

    // Left out: not completed; before the span; another workspace's.
    await seedEvent(database, {
      startsAt: new Date("2026-10-20T18:00:00Z"),
      status: "LIVE",
      workspaceId,
    });
    await completed(workspaceId, "2026-08-01T18:00:00Z");
    await completed(randomUUID(), "2026-10-20T18:00:00Z");
    return { october, november };
  }

  const SPAN = "?from=2026-10-01&to=2026-11-30";

  it("adds up the workspace's completed events in the span, worked out by hand", async () => {
    const client = new ApiClient(app, newAddress());
    const owner = await client.newOwner();
    const { october, november } = await seedWorkspace(client, owner);

    const response = await client.get(owner, `/reports/overview${SPAN}`);

    expect(response.status, response.text).toBe(200);
    const overview = WorkspaceOverview.parse(response.body);
    expect(overview.totals).toEqual({
      events: 2,
      registered: 4,
      verified: 3,
      attended: 3,
      questionsAsked: 2,
      questionsAnswered: 1,
      chatMessages: 1,
      incidents: 1,
      peakAudience: 2,
      averagePeak: 1.5,
    });
    expect(overview.months).toEqual([
      {
        month: "2026-10",
        events: 1,
        registered: 3,
        attended: 2,
        questionsAsked: 2,
      },
      {
        month: "2026-11",
        events: 1,
        registered: 1,
        attended: 1,
        questionsAsked: 0,
      },
    ]);
    expect(overview.events.map(({ id }) => id)).toEqual([november, october]);
  });

  it("lets Analysts read it, and exports it as CSV", async () => {
    const client = new ApiClient(app, newAddress());
    const owner = await client.newOwner();
    await seedWorkspace(client, owner);
    const analyst = await memberOf(client, mailer, owner, "ANALYST");

    expect((await client.get(analyst, `/reports/overview${SPAN}`)).status).toBe(
      200,
    );
    const csv = await client.get(analyst, `/reports/overview.csv${SPAN}`);
    expect(csv.status, csv.text).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.headers["content-disposition"]).toBe(
      'attachment; filename="overview-2026-10-01-to-2026-11-30.csv"',
    );
    expect(csv.text).toMatch(
      /^metric,value\r\nfrom,2026-10-01\r\nto,2026-11-30\r\nevents,2\r\n/,
    );
  });

  it("covers the last twelve months by default, and refuses a span it cannot use", async () => {
    const client = new ApiClient(app, newAddress());
    const owner = await client.newOwner();

    const byDefault = WorkspaceOverview.parse(
      (await client.get(owner, "/reports/overview")).body,
    );
    expect(byDefault.months).toHaveLength(12);
    expect(byDefault.to).toBe(new Date().toISOString().slice(0, 10));

    for (const query of [
      "?from=2026-10-01",
      "?from=2026-11-30&to=2026-10-01",
      "?from=2020-01-01&to=2026-01-01",
    ]) {
      const refused = await client.get(owner, `/reports/overview${query}`);
      expect(refused.status, query).toBe(400);
      expect(ProblemDetails.parse(refused.body).code).toBe("VALIDATION_FAILED");
    }
  });
});
