import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { hashToken } from "../auth/tokens.js";
import { DEMO_WORKSPACE } from "../demo/demo-accounts.js";
import { tokenFromEmail } from "../testing/api-client.js";
import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import { loadTestConfig } from "../testing/config.js";
import {
  blockWrites,
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestWorker } from "../testing/test-app.js";
import { ReminderSender } from "./reminder-sender.js";
import { attendeeOfUnsubscribeToken } from "./unsubscribe-token.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** A clock the tests set by hand. */
class ManualClock {
  current = new Date();
  now(): Date {
    return this.current;
  }
}

describe("reminders (FR-AD-5)", () => {
  let database: TestDatabase;
  let worker: INestApplicationContext;
  const mailer = new CapturingMailer();
  const clock = new ManualClock();
  const extraWorkers: INestApplicationContext[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    worker = await createTestWorker({
      env: { DATABASE_URL: database.url },
      clock,
      mailer,
    });
  });

  afterEach(async () => {
    clock.current = new Date();
    await Promise.all(extraWorkers.splice(0).map((other) => other.close()));
  });

  afterAll(async () => {
    await worker.close();
    await database.drop();
  });

  const sendDue = () => worker.get(ReminderSender).sendDue();
  const startingIn = (ms: number) => new Date(clock.current.getTime() + ms);

  it("sends each reminder once: a day before, then an hour before", async () => {
    const event = await seedEvent(database, {
      startsAt: startingIn(23 * HOUR_MS),
    });
    const { id, email } = await seedAttendee(database, event.eventId);

    expect(await sendDue()).toBeGreaterThanOrEqual(1);
    expect(await sendDue()).toBe(0);
    expect(mailer.to(email).map(({ subject }) => subject)).toEqual([
      "Tomorrow: Seeded event",
    ]);

    clock.current = new Date(clock.current.getTime() + 22.5 * HOUR_MS);
    await sendDue();
    await sendDue();

    expect(mailer.to(email).map(({ subject }) => subject)).toEqual([
      "Tomorrow: Seeded event",
      "Starting in an hour: Seeded event",
    ]);
    const message = mailer.to(email)[1]?.text ?? "";
    expect(message).toContain(`/e/${event.slug}`);
    // The unsubscribe link names this attendee.
    expect(
      attendeeOfUnsubscribeToken(
        loadTestConfig().auth.jwtSecret,
        tokenFromEmail(message),
      ),
    ).toBe(id);
  });

  it("reminds nobody who should not be reminded", async () => {
    const soon = startingIn(2 * HOUR_MS);
    const open = await seedEvent(database, { startsAt: soon });
    const cancelled = await seedEvent(database, {
      startsAt: soon,
      status: "CANCELLED",
    });
    const domains = await seedEvent(database, {
      startsAt: soon,
      mode: "EMAIL_DOMAIN",
      allowedDomains: ["partner.org"],
    });
    const invitations = await seedEvent(database, {
      startsAt: soon,
      mode: "INVITE_ONLY",
    });
    const tooFar = await seedEvent(database, {
      startsAt: startingIn(25 * HOUR_MS),
    });
    const started = await seedEvent(database, {
      startsAt: startingIn(-MINUTE_MS),
    });
    const nobody = [
      await seedAttendee(database, open.eventId, { status: "PENDING" }),
      await seedAttendee(database, open.eventId, { status: "REVOKED" }),
      await seedAttendee(database, open.eventId, { remindersOptIn: false }),
      await seedAttendee(database, cancelled.eventId),
      // No longer admitted: the policy changed, or no invitation.
      await seedAttendee(database, domains.eventId),
      await seedAttendee(database, invitations.eventId),
      await seedAttendee(database, tooFar.eventId),
      await seedAttendee(database, started.eventId),
    ];

    await sendDue();

    for (const { email } of nobody) {
      expect(mailer.to(email), email).toEqual([]);
    }
    const recorded = await database.query(
      "SELECT 1 FROM reminder_deliveries WHERE attendee_id = ANY($1)",
      [nobody.map(({ id }) => id)],
    );
    expect(recorded).toHaveLength(0);
  });

  it("sends nothing to someone who opts out while the run is under way", async () => {
    const event = await seedEvent(database, {
      startsAt: startingIn(3 * HOUR_MS),
    });
    const { id, email } = await seedAttendee(database, event.eventId);
    // The run has listed the attendee and waits for their row, which this
    // holds while they opt out.
    const block = await holdLock(
      database.url,
      "SELECT id FROM attendees WHERE id = $1 FOR UPDATE",
      [id],
    );
    const run = sendDue();
    try {
      await block.waitForWaiters(1);
      await block.run(
        "UPDATE attendees SET reminders_opt_in = false WHERE id = $1",
        [id],
      );
    } finally {
      await block.release();
    }

    expect(await run).toBe(0);
    expect(mailer.to(email)).toEqual([]);
  });

  it.each([
    [
      "a policy made stricter",
      `UPDATE access_policies SET mode = 'EMAIL_DOMAIN',
         allowed_domains = ARRAY['partner.org'] WHERE event_id = $1`,
    ],
    [
      "the event cancelled",
      "UPDATE events SET status = 'CANCELLED' WHERE id = $1",
    ],
    [
      "the attendee revoked",
      `UPDATE attendees SET status = 'REVOKED', revoked_at = now()
       WHERE event_id = $1`,
    ],
  ])(
    "sends nothing when %s while the run is under way",
    async (_label, change) => {
      const event = await seedEvent(database, {
        startsAt: startingIn(3 * HOUR_MS),
      });
      const { email } = await seedAttendee(database, event.eventId);
      // A Manager's change holds the event's row; the run has listed the
      // attendee and waits for that row, then decides under the change.
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.eventId],
      );
      const run = sendDue();
      try {
        await block.waitForWaiters(1);
        await block.run(change, [event.eventId]);
      } finally {
        await block.release();
      }

      expect(await run).toBe(0);
      expect(mailer.to(email)).toEqual([]);
    },
  );

  it("sends a reminder once when two workers run at the same moment", async () => {
    const event = await seedEvent(database, {
      startsAt: startingIn(3 * HOUR_MS),
    });
    const { email } = await seedAttendee(database, event.eventId);
    const other = await createTestWorker({
      env: { DATABASE_URL: database.url },
      clock,
      mailer,
    });
    extraWorkers.push(other);
    // The first holds the attendee and waits to record the reminder; the
    // second waits for the attendee.
    const block = await blockWrites(database.url, "reminder_deliveries");
    const runs = [worker, other].map((each) =>
      each.get(ReminderSender).sendDue(),
    );
    try {
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }
    await Promise.all(runs);

    expect(mailer.to(email)).toHaveLength(1);
  });

  it("puts a demo attendee's reminder in their demo inbox, and sends nothing", async () => {
    const event = await seedEvent(database, {
      startsAt: startingIn(3 * HOUR_MS),
      workspaceId: DEMO_WORKSPACE.id,
    });
    const keyHash = hashToken("a-browser-key");
    const { id, email } = await seedAttendee(database, event.eventId, {
      demoInboxKeyHash: keyHash,
    });

    await sendDue();

    expect(mailer.to(email)).toEqual([]);
    const inbox = await database.query<{ subject: string }>(
      "SELECT subject FROM demo_inbox_messages WHERE attendee_id = $1 AND inbox_key_hash = $2",
      [id, keyHash],
    );
    expect(inbox.map(({ subject }) => subject)).toEqual([
      "Tomorrow: Seeded event",
    ]);
  });
});
