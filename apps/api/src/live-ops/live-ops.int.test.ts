import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  Incident,
  LiveOps,
  LiveOpsAudience,
  LiveOpsRates,
  LiveOpsStreamStatus,
  Member,
  ProblemDetails,
} from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { openEvent } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
} from "../testing/api-client.js";
import { seedAttendee } from "../testing/audience-seed.js";
import { cookieHeader } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { listen } from "../testing/realtime.js";
import { SseClient } from "../testing/sse.js";
import { createTestApp, LogCapture } from "../testing/test-app.js";
import {
  LiveOpsStreams,
  LiveOpsTiming,
  STREAMS_PER_SESSION,
} from "./live-ops-streams.js";

let addressCounter = 0;
const newAddress = () => `198.18.8.${String((addressCounter += 1) % 250)}`;

const MINUTE_MS = 60_000;

/** Looks every 100 ms; figures every 600 ms; a comment after 300 ms idle. */
class FastTiming extends LiveOpsTiming {
  override readonly lookEveryMs = 100;
  override readonly figuresEveryMs = 600;
  override readonly keepAliveEveryMs = 300;
}

describe(
  "the operations room (FR-RN-7, docs/04 section 5)",
  { timeout: 30_000 },
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;
    let url: string;
    const mailer = new CapturingMailer();
    const logs = new LogCapture();
    // Frozen in the middle of a minute: seeded minutes stay where they are.
    const clock = new TestClock(
      new Date(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS + 30_000),
    );

    beforeAll(async () => {
      database = await createTestDatabase();
      app = await createTestApp({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          TRUST_PROXY_HOPS: "1",
        },
        mailer,
        clock,
        logs,
        replace: [[LiveOpsTiming, FastTiming]],
      });
      url = await listen(app);
    });

    afterAll(async () => {
      await app.close();
      await database.drop();
    });

    const api = () => new ApiClient(app, newAddress());
    const minute = (offset: number) =>
      new Date(
        Math.floor(clock.now().getTime() / MINUTE_MS) * MINUTE_MS +
          offset * MINUTE_MS,
      );

    function open(session: TestSession, eventId: string, lastEventId?: string) {
      return SseClient.open(`${url}/api/v1/events/${eventId}/live-ops/stream`, {
        cookie: cookieHeader({ [ACCESS_COOKIE]: session.access }),
        "x-forwarded-for": newAddress(),
        ...(lastEventId !== undefined && { "last-event-id": lastEventId }),
      });
    }

    async function watched(eventId: string, attendees: number[][]) {
      // attendees[i]: the minutes (offsets from now) attendee i watched.
      for (const minutes of attendees) {
        const attendee = await seedAttendee(database, eventId);
        for (const offset of minutes) {
          await database.query(
            "INSERT INTO attendance_minutes (event_id, attendee_id, minute) VALUES ($1, $2, $3)",
            [eventId, attendee.id, minute(offset)],
          );
        }
      }
    }

    async function chatted(eventId: string, userId: string, agesMs: number[]) {
      let sequence = 1;
      for (const ageMs of agesMs) {
        await database.query(
          `INSERT INTO chat_messages (event_id, sequence, author_user_id, client_message_id, body, created_at)
         VALUES ($1, $2, $3, $4, 'hello', $5)`,
          [
            eventId,
            sequence,
            userId,
            randomUUID(),
            new Date(clock.now().getTime() - ageMs),
          ],
        );
        sequence += 1;
      }
    }

    async function asked(eventId: string, userId: string, agesMs: number[]) {
      for (const ageMs of agesMs) {
        await database.query(
          `INSERT INTO questions (event_id, author_user_id, body, status, created_at)
         VALUES ($1, $2, 'why?', 'PUBLISHED', $3)`,
          [eventId, userId, new Date(clock.now().getTime() - ageMs)],
        );
      }
    }

    async function checked(eventId: string, ok: boolean, at: Date) {
      await database.query(
        `INSERT INTO stream_checks (event_id, url, slot, checked_at, ok, latency_ms)
       VALUES ($1, 'https://s.example/a.m3u8', $2, $2, $3, 42)`,
        [eventId, at, ok],
      );
    }

    it("answers the whole room at once, with figures worked out by hand", async () => {
      const client = api();
      const owner = await client.newOwner();
      const userId = (await client.me(owner)).user.id;
      const event = await openEvent(client, owner);
      // Three watched two minutes ago (the peak), two a minute ago, one now
      // who also watched a minute ago: two watching now.
      await watched(event.id, [[-2, -1, 0], [-2, -1], [-2]]);
      await chatted(
        event.id,
        userId,
        [10_000, 50_000, 59_000, 61_000, 300_000],
      );
      await asked(event.id, userId, [5_000, 70_000]);
      await checked(event.id, false, new Date(clock.now().getTime() - 60_000));
      await checked(event.id, true, new Date(clock.now().getTime() - 5_000));
      const [resolved] = await database.query<{ id: string }>(
        `INSERT INTO incidents (event_id, kind, opened_at, resolved_at)
       VALUES ($1, 'STREAM_UNREACHABLE', $2, $3) RETURNING id`,
        [event.id, minute(-10), minute(-8)],
      );
      const [open] = await database.query<{ id: string }>(
        `INSERT INTO incidents (event_id, kind, opened_at)
       VALUES ($1, 'STREAM_UNREACHABLE', $2) RETURNING id`,
        [event.id, minute(-1)],
      );

      const response = await client.get(owner, `/events/${event.id}/live-ops`);

      expect(response.status, response.text).toBe(200);
      const room = LiveOps.parse(response.body);
      expect(room.event).toMatchObject({ id: event.id, slug: event.slug });
      expect(room.stream).toEqual({
        ok: true,
        checkedAt: new Date(clock.now().getTime() - 5_000).toISOString(),
        latencyMs: 42,
      });
      expect(room.audience.current).toBe(2);
      expect(room.audience.peak).toBe(3);
      expect(room.audience.series).toEqual([
        { minute: minute(-2).toISOString(), viewers: 3 },
        { minute: minute(-1).toISOString(), viewers: 2 },
        { minute: minute(0).toISOString(), viewers: 1 },
      ]);
      expect(room.rates).toEqual({
        messagesPerMinute: 3,
        questionsPerMinute: 1,
      });
      expect(room.incidents.map(({ id }) => id)).toEqual([open?.id]);
      // openEvent's own transitions (from the audit trail), ending in the
      // status shown...
      const transitions = room.timeline.flatMap((moment) =>
        moment.kind === "STATUS_CHANGED" ? [moment] : [],
      );
      expect(transitions[0]?.from).toBe("DRAFT");
      expect(transitions.at(-1)?.to).toBe(room.event.status);
      // ...and the incidents, opened and resolved.
      expect(
        room.timeline.flatMap((moment) =>
          moment.kind === "STATUS_CHANGED"
            ? []
            : [`${moment.kind} ${moment.incidentId}`],
        ),
      ).toEqual([
        `INCIDENT_OPENED ${resolved?.id ?? ""}`,
        `INCIDENT_RESOLVED ${resolved?.id ?? ""}`,
        `INCIDENT_OPENED ${open?.id ?? ""}`,
      ]);
      const times = room.timeline.map(({ at }) => at);
      expect(times).toEqual([...times].sort());
    });

    it("shows another workspace's event to nobody, and the room to every role", async () => {
      const client = api();
      const owner = await client.newOwner();
      const manager = await memberOf(client, mailer, owner, "MANAGER");
      const analyst = await memberOf(client, mailer, owner, "ANALYST");
      const stranger = await client.newOwner("stranger");
      const event = await openEvent(client, owner);

      const theirs = await client.get(stranger, `/events/${event.id}/live-ops`);
      const theirStream = await open(stranger, event.id);
      const anonymous = await SseClient.open(
        `${url}/api/v1/events/${event.id}/live-ops/stream`,
        { "x-forwarded-for": newAddress() },
      );

      expect(ProblemDetails.parse(theirs.body).code).toBe("NOT_FOUND");
      expect(theirStream.status).toBe(404);
      expect(ProblemDetails.parse(JSON.parse(theirStream.body)).code).toBe(
        "NOT_FOUND",
      );
      expect(anonymous.status).toBe(401);
      for (const session of [owner, manager, analyst]) {
        const room = await client.get(session, `/events/${event.id}/live-ops`);
        expect(room.status, room.text).toBe(200);
        expect(LiveOps.parse(room.body).event.id).toBe(event.id);
        const stream = await open(session, event.id);
        try {
          expect(stream.status).toBe(200);
          expect(
            LiveOps.parse((await stream.next("snapshot")).data).event.id,
          ).toBe(event.id);
        } finally {
          stream.close();
        }
      }
    });

    it("ends the stream within a second of the event being deleted", async () => {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      const stream = await open(owner, event.id);
      await stream.next("snapshot");

      const logged = logs.lines.length;

      // As the demo reset deletes its events.
      await database.query("DELETE FROM events WHERE id = $1", [event.id]);

      const started = Date.now();
      await stream.ended;
      expect(Date.now() - started).toBeLessThan(1_500);
      // Ended as an event no longer there, not as a stream that failed.
      expect(
        logs.lines.slice(logged).filter((line) => line.includes('"level":40')),
      ).toEqual([]);
    });

    it("streams a snapshot, then each change within a second, with increasing IDs", async () => {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      const stream = await open(owner, event.id);
      try {
        expect(stream.headers["content-type"]).toBe(
          "text/event-stream; charset=utf-8",
        );
        expect(stream.headers["cache-control"]).toBe("no-cache, no-transform");
        const snapshot = await stream.next("snapshot");
        expect(LiveOps.parse(snapshot.data).stream).toBeNull();
        expect(stream.retry).toBe(2000);

        // A check.
        const checkedAt = new Date(clock.now().getTime() - 1_000);
        await checked(event.id, false, checkedAt);
        const status = await stream.next("stream.status", 0, 1_500);
        expect(LiveOpsStreamStatus.parse(status.data)).toEqual({
          ok: false,
          checkedAt: checkedAt.toISOString(),
          latencyMs: 42,
        });

        // An incident, opened then resolved.
        const [incident] = await database.query<{ id: string }>(
          `INSERT INTO incidents (event_id, kind, opened_at)
         VALUES ($1, 'STREAM_UNREACHABLE', $2) RETURNING id`,
          [event.id, clock.now()],
        );
        const opened = await stream.next("incident.opened", 0, 1_500);
        expect(Incident.parse(opened.data)).toMatchObject({
          id: incident?.id,
          resolvedAt: null,
        });
        await database.query(
          "UPDATE incidents SET resolved_at = $2 WHERE id = $1",
          [incident?.id, clock.now()],
        );
        const resolved = await stream.next("incident.resolved", 0, 1_500);
        expect(Incident.parse(resolved.data).resolvedAt).toEqual(
          clock.now().toISOString(),
        );

        // A status change: a whole new snapshot.
        const before = stream.messages.length;
        await client.send(owner, "post", `/events/${event.id}/transitions`, {
          to: "CANCELLED",
        });
        const fresh = await stream.next("snapshot", before, 1_500);
        expect(LiveOps.parse(fresh.data).event.status).toBe("CANCELLED");

        // Figures on their own clock, and a comment when idle.
        LiveOpsAudience.parse((await stream.next("audience.updated")).data);
        LiveOpsRates.parse((await stream.next("rates.updated")).data);
        await expect
          .poll(() => stream.comments, { timeout: 2_000 })
          .toBeGreaterThan(0);

        const ids = stream.messages.map(({ id }) => Number(id));
        expect(ids[0]).toBe(1);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        expect(new Set(ids).size).toBe(ids.length);
        // Each sent once.
        expect(stream.named("incident.opened")).toHaveLength(1);
        expect(stream.named("incident.resolved")).toHaveLength(1);
        expect(stream.named("stream.status")).toHaveLength(1);
      } finally {
        stream.close();
      }
    });

    it("starts again from a snapshot after Last-Event-ID, numbered after it", async () => {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);

      const stream = await open(owner, event.id, "41");
      const odd = await open(owner, event.id, "not-a-number");
      try {
        expect(await stream.next("snapshot")).toMatchObject({ id: "42" });
        expect(await odd.next("snapshot")).toMatchObject({ id: "1" });
      } finally {
        stream.close();
        odd.close();
      }
    });

    it("ends the stream within a second of signing out or losing the membership", async () => {
      const client = api();
      const owner = await client.newOwner();
      const analyst = await memberOf(client, mailer, owner, "ANALYST");
      const event = await openEvent(client, owner);
      const owners = await open(owner, event.id);
      const analysts = await open(analyst, event.id);
      await owners.next("snapshot");
      await analysts.next("snapshot");

      const members = z
        .array(Member)
        .parse((await client.get(owner, "/workspace/members")).body);
      const membership = members.find(({ email }) => email === analyst.email);
      await client.send(
        owner,
        "delete",
        `/workspace/members/${membership?.membershipId ?? ""}`,
      );
      await client
        .post("/auth/sign-out", {})
        .set("Cookie", cookieHeader({ [REFRESH_COOKIE]: owner.refresh }));

      const started = Date.now();
      await Promise.all([owners.ended, analysts.ended]);
      expect(Date.now() - started).toBeLessThan(1_500);
    });

    it("ends the stream within a second of switching to another workspace", async () => {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      const other = await client.newOwner("other");
      await client.send(other, "post", "/workspace/invitations", {
        email: owner.email,
        role: "ANALYST",
      });
      const accept = await client.post("/team-invitations/accept", {
        token: tokenFromEmail(mailer.to(owner.email).at(-1)?.text ?? ""),
      });
      expect(accept.status, accept.text).toBe(204);
      const stream = await open(owner, event.id);
      await stream.next("snapshot");

      await client.send(owner, "put", "/me/active-workspace", {
        workspaceId: (await client.me(other)).activeWorkspace.workspaceId,
      });

      const started = Date.now();
      await stream.ended;
      expect(Date.now() - started).toBeLessThan(1_500);
    });

    it(`refuses a session's stream past ${String(STREAMS_PER_SESSION)}`, async () => {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      const streams = [];
      try {
        for (let index = 0; index < STREAMS_PER_SESSION; index += 1) {
          streams.push(await open(owner, event.id));
        }
        const refused = await open(owner, event.id);

        expect(streams.map(({ status }) => status)).toEqual(
          Array.from({ length: STREAMS_PER_SESSION }, () => 200),
        );
        expect(refused.status).toBe(429);

        // Closing one makes room.
        streams.pop()?.close();
        await expect
          .poll(async () => {
            const again = await open(owner, event.id);
            again.close();
            return again.status;
          })
          .toBe(200);
      } finally {
        for (const stream of streams) {
          stream.close();
        }
      }
    });

    it("brings each change within 2 seconds at the production timing (FR-RN-7)", async () => {
      const real = await createTestApp({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          TRUST_PROXY_HOPS: "1",
        },
      });
      try {
        const realUrl = await listen(real);
        const client = new ApiClient(real, newAddress());
        const owner = await client.newOwner();
        const event = await openEvent(client, owner);
        const stream = await SseClient.open(
          `${realUrl}/api/v1/events/${event.id}/live-ops/stream`,
          {
            cookie: cookieHeader({ [ACCESS_COOKIE]: owner.access }),
            "x-forwarded-for": newAddress(),
          },
        );
        try {
          await stream.next("snapshot");
          // Each made just after the last arrived, so a slower look shows.
          const delays: number[] = [];
          for (let check = 1; check <= 3; check += 1) {
            const before = stream.messages.length;
            const started = Date.now();
            await checked(event.id, true, new Date(Date.now() + check * 1_000));
            await stream.next("stream.status", before, 4_000);
            delays.push(Date.now() - started);
          }
          expect(Math.max(...delays)).toBeLessThan(2_000);
        } finally {
          stream.close();
        }
      } finally {
        await real.close();
      }
    });

    it("ends every stream when the application shuts down", async () => {
      const other = await createTestApp({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          TRUST_PROXY_HOPS: "1",
        },
        replace: [[LiveOpsTiming, FastTiming]],
      });
      const otherUrl = await listen(other);
      const client = new ApiClient(other, newAddress());
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      const stream = await SseClient.open(
        `${otherUrl}/api/v1/events/${event.id}/live-ops/stream`,
        {
          cookie: cookieHeader({ [ACCESS_COOKIE]: owner.access }),
          "x-forwarded-for": newAddress(),
        },
      );
      await stream.next("snapshot");

      await other.close();

      await stream.ended;
      expect(other.get(LiveOpsStreams).size).toBe(0);
    });
  },
);
