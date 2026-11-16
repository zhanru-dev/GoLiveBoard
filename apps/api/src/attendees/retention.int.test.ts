import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { createTestWorker } from "../testing/test-app.js";
import { RetentionJob } from "./retention-job.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("the daily retention job (FR-AD-6, docs/03 section 8)", () => {
  let database: TestDatabase;
  let worker: INestApplicationContext;

  beforeAll(async () => {
    database = await createTestDatabase();
    worker = await createTestWorker({ env: { DATABASE_URL: database.url } });
  });

  afterAll(async () => {
    await worker.close();
    await database.drop();
  });

  const run = () => worker.get(RetentionJob).run();

  async function attendeeRow(id: string) {
    const [row] = await database.query<{
      name: string;
      email: string;
      status: string;
    }>(
      "SELECT name, email::text AS email, status::text AS status FROM attendees WHERE id = $1",
      [id],
    );
    return row;
  }

  it("anonymises attendees once the workspace's retention period after the event has passed, and audits it as SYSTEM", async () => {
    // Events last an hour: these ended 91 and 89 days ago.
    const expired = await seedEvent(database, { startsAt: ago(91) });
    const recent = await seedEvent(database, { startsAt: ago(89) });
    const shortRetention = await seedEvent(database, {
      startsAt: ago(31),
      retentionDays: 30,
    });
    const gone = await seedAttendee(database, expired.eventId);
    const kept = await seedAttendee(database, recent.eventId);
    const short = await seedAttendee(database, shortRetention.eventId);
    await database.query(
      "INSERT INTO attendee_invitations (event_id, email) VALUES ($1, $2), ($3, $4)",
      [expired.eventId, gone.email, recent.eventId, kept.email],
    );

    const first = await run();
    const second = await run();

    expect(first.anonymised).toBe(2);
    expect(second.anonymised).toBe(0);
    for (const id of [gone.id, short.id]) {
      const row = await attendeeRow(id);
      expect(row?.name).toBe("Former attendee");
      expect(row?.status).toBe("ERASED");
      expect(row?.email).toMatch(/@anonymised\.invalid$/);
    }
    expect(await attendeeRow(kept.id)).toMatchObject({
      email: kept.email,
      status: "VERIFIED",
    });
    const audit = await database.query<{
      actor_kind: string;
      target_id: string;
    }>(
      `SELECT actor_kind::text AS actor_kind, target_id FROM audit_entries
       WHERE action = 'attendee.anonymised' ORDER BY target_id`,
    );
    expect(audit).toEqual(
      [gone.id, short.id]
        .sort()
        .map((id) => ({ actor_kind: "SYSTEM", target_id: id })),
    );
    const invitations = await database.query<{ email: string }>(
      "SELECT email::text AS email FROM attendee_invitations",
    );
    expect(invitations.map(({ email }) => email)).toEqual([kept.email]);
  });

  it("deletes used and expired links, expired sessions, old stream checks and old audit entries, and keeps the rest", async () => {
    const event = await seedEvent(database, {
      startsAt: new Date(Date.now() + DAY_MS),
    });
    const attendee = await seedAttendee(database, event.eventId);
    await database.query(
      `INSERT INTO attendee_verification_tokens (attendee_id, token_hash, expires_at, used_at)
       VALUES ($1, 'used', now() + interval '10 minutes', now()),
              ($1, 'expired', now() - interval '1 minute', NULL),
              ($1, 'live', now() + interval '10 minutes', NULL)`,
      [attendee.id],
    );
    await database.query(
      `INSERT INTO attendee_sessions (attendee_id, token_hash, expires_at)
       VALUES ($1, 'old-session', now() - interval '1 minute'),
              ($1, 'live-session', now() + interval '1 day')`,
      [attendee.id],
    );
    await database.query(
      `INSERT INTO stream_checks (event_id, url, slot, checked_at, ok, latency_ms)
       VALUES ($1, 'https://s.example/a.m3u8', now() - interval '31 days', now() - interval '31 days', true, 10),
              ($1, 'https://s.example/a.m3u8', now() - interval '1 day', now() - interval '1 day', true, 10)`,
      [event.eventId],
    );
    await database.query(
      `INSERT INTO idempotency_records (scope, key, request_hash, response_status, response_body, expires_at)
       VALUES ('s', gen_random_uuid(), 'h', 201, '{}', now() - interval '1 minute'),
              ('s', gen_random_uuid(), 'h', 201, '{}', now() + interval '1 hour')`,
    );
    await database.query(
      `INSERT INTO audit_entries (workspace_id, actor_kind, action, target_type, target_id, created_at)
       VALUES ($1, 'SYSTEM', 'old.thing', 'x', gen_random_uuid(), now() - interval '731 days'),
              ($1, 'SYSTEM', 'new.thing', 'x', gen_random_uuid(), now())`,
      [event.workspaceId],
    );

    const [hook] = await database.query<{ id: string }>(
      `INSERT INTO webhook_endpoints (workspace_id, url, event_types, secret_ciphertext, secret_key_id)
       VALUES ($1, 'https://hooks.example.com/in', '{event.live}', '\\x00', 'k') RETURNING id`,
      [event.workspaceId],
    );
    await database.query(
      `INSERT INTO webhook_deliveries
         (endpoint_id, event_id, event_type, data, occurred_at, status, attempts, next_attempt_at, created_at)
       VALUES ($1, gen_random_uuid(), 'old-done', '{}', now(), 'SUCCEEDED', 1, NULL, now() - interval '31 days'),
              ($1, gen_random_uuid(), 'old-pending', '{}', now(), 'PENDING', 1, now(), now() - interval '31 days'),
              ($1, gen_random_uuid(), 'new-done', '{}', now(), 'FAILED', 5, NULL, now() - interval '1 day')`,
      [hook?.id],
    );
    await database.query(
      `INSERT INTO webhook_attempts (delivery_id, attempted_at, duration_ms)
       SELECT id, now() - interval '31 days', 10 FROM webhook_deliveries WHERE event_type = 'old-pending'
       UNION ALL
       SELECT id, now(), 10 FROM webhook_deliveries WHERE event_type = 'old-pending'`,
    );

    await run();

    const left = async (sql: string, values: unknown[] = []) =>
      (await database.query<{ v: string }>(sql, values)).map(({ v }) => v);
    expect(
      await left(
        "SELECT token_hash AS v FROM attendee_verification_tokens WHERE attendee_id = $1",
        [attendee.id],
      ),
    ).toEqual(["live"]);
    expect(
      await left(
        "SELECT token_hash AS v FROM attendee_sessions WHERE attendee_id = $1",
        [attendee.id],
      ),
    ).toEqual(["live-session"]);
    expect(
      (
        await left(
          "SELECT event_type AS v FROM webhook_deliveries WHERE endpoint_id = $1",
          [hook?.id],
        )
      ).sort(),
    ).toEqual(["new-done", "old-pending"]);
    expect(
      await left(
        `SELECT (attempted_at > now() - interval '2 days')::text AS v
         FROM webhook_attempts AS attempt
         JOIN webhook_deliveries AS delivery ON delivery.id = attempt.delivery_id
         WHERE delivery.endpoint_id = $1`,
        [hook?.id],
      ),
    ).toEqual(["true"]);
    expect(
      await left(
        "SELECT (checked_at > now() - interval '2 days')::text AS v FROM stream_checks WHERE event_id = $1",
        [event.eventId],
      ),
    ).toEqual(["true"]);
    expect(
      await left(
        "SELECT (expires_at > now())::text AS v FROM idempotency_records WHERE scope = 's'",
      ),
    ).toEqual(["true"]);
    expect(
      await left(
        "SELECT action AS v FROM audit_entries WHERE workspace_id = $1",
        [event.workspaceId],
      ),
    ).toEqual(["new.thing"]);
  });

  it("anonymises an attendee once when two runs overlap", async () => {
    const event = await seedEvent(database, { startsAt: ago(100) });
    const attendee = await seedAttendee(database, event.eventId);
    const other = await createTestWorker({
      env: { DATABASE_URL: database.url },
    });
    try {
      // The first run holds the event and the attendee and waits to delete
      // the invitations; the second waits for the event.
      const block = await blockWrites(database.url, "attendee_invitations");
      const runs = [worker, other].map((each) => each.get(RetentionJob).run());
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }
      const outcomes = await Promise.all(runs);

      expect(outcomes.map(({ anonymised }) => anonymised).sort()).toEqual([
        0, 1,
      ]);
      const audit = await database.query(
        "SELECT 1 FROM audit_entries WHERE target_id = $1",
        [attendee.id],
      );
      expect(audit).toHaveLength(1);
    } finally {
      await other.close();
    }
  });
});
