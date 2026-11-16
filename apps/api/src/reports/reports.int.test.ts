import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { EventReport, ProblemDetails } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

let addressCounter = 0;
const newAddress = () => `198.18.9.${String((addressCounter += 1) % 250)}`;

const MINUTE_MS = 60_000;

describe("the post-event report (FR-RC-3)", { timeout: 30_000 }, () => {
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

  const api = () => new ApiClient(app, newAddress());

  async function liveEvent(client: ApiClient, owner: TestSession) {
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    // Two hours ago, on the minute, for an hour.
    const startsAt = new Date(
      Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - 120 * MINUTE_MS,
    );
    const event = await seedEvent(database, {
      startsAt,
      status: "LIVE",
      workspaceId,
    });
    return { ...event, startsAt };
  }

  const transition = (
    client: ApiClient,
    session: TestSession,
    eventId: string,
    to: string,
  ) => client.send(session, "post", `/events/${eventId}/transitions`, { to });

  async function report(
    client: ApiClient,
    session: TestSession,
    eventId: string,
  ) {
    const response = await client.get(session, `/events/${eventId}/report`);
    expect(response.status, response.text).toBe(200);
    return EventReport.parse(response.body);
  }

  it("matches the figures worked out by hand for a seeded event (the exit criterion)", async () => {
    const client = api();
    const owner = await client.newOwner();
    const userId = (await client.me(owner)).user.id;
    const { eventId, startsAt } = await liveEvent(client, owner);
    const at = (minutes: number, seconds = 0) =>
      new Date(startsAt.getTime() + minutes * MINUTE_MS + seconds * 1000);

    // Registered 5: A, B, C and D confirmed their address, E did not.
    const [a, b, c] = [
      await seedAttendee(database, eventId),
      await seedAttendee(database, eventId),
      await seedAttendee(database, eventId),
    ];
    await seedAttendee(database, eventId);
    await seedAttendee(database, eventId, { status: "PENDING" });
    // A watched minutes 0-9, B 5-14, C the minute before the start and
    // minute 0. D never watched.
    const watched: [string, number][] = [
      ...Array.from({ length: 10 }, (_, i): [string, number] => [a.id, i]),
      ...Array.from({ length: 10 }, (_, i): [string, number] => [b.id, 5 + i]),
      [c.id, -1],
      [c.id, 0],
    ];
    for (const [attendeeId, minute] of watched) {
      await database.query(
        "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
        [eventId, attendeeId, at(minute)],
      );
    }
    // Chat: three messages in minute 0, one in minute 5, and one after the
    // end (since removed), which counts in the total only.
    const messages: [Date, boolean][] = [
      [at(0, 10), false],
      [at(0, 30), false],
      [at(0, 59), false],
      [at(5, 10), false],
      [at(70), true],
    ];
    let sequence = 0;
    for (const [createdAt, removed] of messages) {
      sequence += 1;
      await database.query(
        `INSERT INTO chat_messages
           (event_id, sequence, author_user_id, client_message_id, body, created_at, deleted_at, deleted_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId,
          sequence,
          userId,
          randomUUID(),
          removed ? "" : "hello",
          createdAt,
          removed ? createdAt : null,
          removed ? userId : null,
        ],
      );
    }
    // Questions: four asked, two answered.
    for (const status of ["ANSWERED", "ANSWERED", "PUBLISHED", "HIDDEN"]) {
      await database.query(
        `INSERT INTO questions (event_id, author_user_id, body, status)
         VALUES ($1, $2, 'why?', $3::question_status)`,
        [eventId, userId, status],
      );
    }
    // Incidents: 5:30-7:00 (minutes 5 and 6; it ended as minute 7 began),
    // and one opened at 50:00 never resolved (minutes 50-59).
    await database.query(
      `INSERT INTO incidents (event_id, kind, opened_at, resolved_at)
       VALUES ($1, 'STREAM_UNREACHABLE', $2, $3),
              ($1, 'STREAM_UNREACHABLE', $4, NULL)`,
      [eventId, at(5, 30), at(7), at(50)],
    );
    expect(
      ProblemDetails.parse(
        (await client.get(owner, `/events/${eventId}/report`)).body,
      ).code,
    ).toBe("REPORT_NOT_AVAILABLE");

    const completed = await transition(client, owner, eventId, "COMPLETED");
    expect(completed.status, completed.text).toBe(200);
    const result = await report(client, owner, eventId);

    expect(result.funnel).toEqual({ registered: 5, verified: 4, attended: 3 });
    // Minutes -1 to 59: 61 of them. Viewers: 1 (C), 2 (A, C), 1 four
    // times (A), 2 five times (A, B), 1 five times (B), then 0.
    // 1 + 2 + 4 + 10 + 5 = 22 viewer-minutes; 22 / 61 = 0.36 → 0.4.
    expect(result.audience.peak).toBe(2);
    expect(result.audience.average).toBe(0.4);
    expect(result.audience.series).toHaveLength(61);
    const viewers = [1, 2, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1];
    expect(result.audience.series.map((point) => point.viewers)).toEqual([
      ...viewers,
      ...Array.from({ length: 45 }, () => 0),
    ]);
    expect(result.audience.series[0]?.minute).toBe(at(-1).toISOString());
    expect(result.audience.series.at(-1)?.minute).toBe(at(59).toISOString());
    const byMinute = (minute: number) => result.audience.series[minute + 1];
    expect(byMinute(0)?.messages).toBe(3);
    expect(byMinute(5)?.messages).toBe(1);
    expect(
      result.audience.series.reduce((sum, point) => sum + point.messages, 0),
    ).toBe(4);
    expect(
      result.audience.series.flatMap((point, index) =>
        point.incident ? [index - 1] : [],
      ),
    ).toEqual([5, 6, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(result.incidents).toHaveLength(2);
    expect(result.questions).toEqual({ asked: 4, answered: 2 });
    expect(result.chat).toEqual({ messages: 5 });
  });

  it("keeps the audience fixed at completion, and counts what moderators do after", async () => {
    const client = api();
    const owner = await client.newOwner();
    const userId = (await client.me(owner)).user.id;
    const { eventId, startsAt } = await liveEvent(client, owner);
    const attendee = await seedAttendee(database, eventId);
    await database.query(
      "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
      [eventId, attendee.id, startsAt],
    );
    const [question] = await database.query<{ id: string }>(
      `INSERT INTO questions (event_id, author_user_id, body, status)
       VALUES ($1, $2, 'why?', 'PUBLISHED') RETURNING id`,
      [eventId, userId],
    );
    await transition(client, owner, eventId, "COMPLETED");
    // Written by the transition itself, before anyone asked.
    const [stored] = await database.query<{ generated_at: Date }>(
      "SELECT generated_at FROM event_reports WHERE event_id = $1",
      [eventId],
    );
    expect(stored).toBeDefined();
    const before = await report(client, owner, eventId);

    // Written behind the API's back: nothing may change the stored figures.
    await database.query(
      "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
      [eventId, attendee.id, new Date(startsAt.getTime() + MINUTE_MS)],
    );
    await database.query(
      "UPDATE questions SET status = 'ANSWERED' WHERE id = $1",
      [question?.id],
    );
    const after = await report(client, owner, eventId);

    expect(before.audience.series[1]?.viewers).toBe(0);
    expect(after.audience).toEqual(before.audience);
    expect(after.generatedAt).toBe(before.generatedAt);
    expect(after.questions).toEqual({ asked: 1, answered: 1 });
    // Still there once archived.
    await transition(client, owner, eventId, "ARCHIVED");
    expect((await report(client, owner, eventId)).event.status).toBe(
      "ARCHIVED",
    );
  });

  it("has no report for an event that never completed, archived or not", async () => {
    const client = api();
    const owner = await client.newOwner();
    const { eventId } = await liveEvent(client, owner);
    await transition(client, owner, eventId, "CANCELLED");
    const cancelled = await client.get(owner, `/events/${eventId}/report`);
    await transition(client, owner, eventId, "ARCHIVED");
    const archived = await client.get(owner, `/events/${eventId}/report.csv`);

    expect(ProblemDetails.parse(cancelled.body).code).toBe(
      "REPORT_NOT_AVAILABLE",
    );
    expect(archived.status).toBe(409);
    expect(
      await database.query("SELECT 1 FROM event_reports WHERE event_id = $1", [
        eventId,
      ]),
    ).toEqual([]);
  });

  it("makes the report of an event that completed before reports were stored", async () => {
    const client = api();
    const owner = await client.newOwner();
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    const startsAt = new Date(
      Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - 120 * MINUTE_MS,
    );
    const completed = await seedEvent(database, {
      startsAt,
      status: "COMPLETED",
      workspaceId,
    });
    const archived = await seedEvent(database, {
      startsAt,
      status: "ARCHIVED",
      workspaceId,
    });
    const neverCompleted = await seedEvent(database, {
      startsAt,
      status: "ARCHIVED",
      workspaceId,
    });
    await database.query(
      `INSERT INTO audit_entries (workspace_id, actor_kind, action, target_type, target_id, event_id, before, after)
       VALUES ($1, 'SYSTEM', 'event.transitioned', 'event', $2, $2, '{"status":"LIVE"}', '{"status":"COMPLETED"}'),
              ($1, 'SYSTEM', 'event.transitioned', 'event', $3, $3, '{"status":"READY"}', '{"status":"CANCELLED"}')`,
      [workspaceId, archived.eventId, neverCompleted.eventId],
    );
    const attendee = await seedAttendee(database, completed.eventId);
    await database.query(
      "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
      [completed.eventId, attendee.id, startsAt],
    );

    const first = await report(client, owner, completed.eventId);
    const again = await report(client, owner, completed.eventId);
    const fromAudit = await client.get(
      owner,
      `/events/${archived.eventId}/report`,
    );
    const refused = await client.get(
      owner,
      `/events/${neverCompleted.eventId}/report`,
    );

    expect(first.funnel.attended).toBe(1);
    expect(first.audience.peak).toBe(1);
    expect(again.generatedAt).toBe(first.generatedAt);
    expect(fromAudit.status, fromAudit.text).toBe(200);
    expect(ProblemDetails.parse(refused.body).code).toBe(
      "REPORT_NOT_AVAILABLE",
    );
  });

  it("exports the report as CSV, safe to open in a spreadsheet", async () => {
    const client = api();
    const owner = await client.newOwner();
    const { eventId, slug } = await liveEvent(client, owner);
    await database.query("UPDATE events SET title = $2 WHERE id = $1", [
      eventId,
      '=HYPERLINK("https://evil.example","Click")',
    ]);
    await transition(client, owner, eventId, "COMPLETED");

    const response = await client.get(owner, `/events/${eventId}/report.csv`);

    expect(response.status, response.text).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="report-${slug}.csv"`,
    );
    const lines = response.text.split("\r\n");
    expect(lines.slice(0, 2)).toEqual([
      "metric,value",
      `event,"'=HYPERLINK(""https://evil.example"",""Click"")"`,
    ]);
    expect(lines).toContain("registered,0");
    expect(lines).toContain("minute,viewers,chat_messages,incident_open");
  });

  it("shows each workspace its own reports only, to every role", async () => {
    const client = api();
    const owner = await client.newOwner();
    const analyst = await memberOf(client, mailer, owner, "ANALYST");
    const stranger = await client.newOwner("stranger");
    const { eventId } = await liveEvent(client, owner);
    await transition(client, owner, eventId, "COMPLETED");

    const theirs = await client.get(stranger, `/events/${eventId}/report`);
    const theirCsv = await client.get(
      stranger,
      `/events/${eventId}/report.csv`,
    );

    expect((await report(client, analyst, eventId)).event.id).toBe(eventId);
    expect(ProblemDetails.parse(theirs.body).code).toBe("NOT_FOUND");
    expect(theirCsv.status).toBe(404);
  });
});
