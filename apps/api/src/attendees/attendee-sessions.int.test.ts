import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { createTestApp } from "../testing/test-app.js";
import { AttendeeSessions } from "./attendee-sessions.js";

/**
 * Prisma reads a session's attendee and event with separate queries. A
 * revocation (sessions deleted and attendee marked, in one transaction)
 * committing between them must not be seen half done.
 */
describe(
  "AttendeeSessions, read from one snapshot",
  { timeout: 30_000 },
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;

    beforeAll(async () => {
      database = await createTestDatabase();
      app = await createTestApp({
        env: { DATABASE_URL: database.url, VALKEY_URL: inject("valkeyUrl") },
      });
    });

    afterAll(async () => {
      await app.close();
      await database.drop();
    });

    it("never sees a live session for an attendee revoked meanwhile", async () => {
      const event = await seedEvent(database, {
        startsAt: new Date(Date.now() + 3_600_000),
      });
      const attendee = await seedAttendee(database, event.eventId);
      const [session] = await database.query<{ id: string }>(
        `INSERT INTO attendee_sessions (attendee_id, token_hash, expires_at)
       VALUES ($1, 'snapshot-test', now() + interval '1 day') RETURNING id`,
        [attendee.id],
      );
      // The session query goes through; the attendee query waits.
      const block = await holdLock(
        database.url,
        "LOCK TABLE attendees IN ACCESS EXCLUSIVE MODE",
      );
      let check;
      try {
        const reading = app.get(AttendeeSessions).byId(session?.id ?? "");
        await block.waitForWaiters(1);
        // The revocation, as the API does it: one transaction.
        await block.run(
          "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE id = $1",
          [attendee.id],
        );
        await block.run(
          "DELETE FROM attendee_sessions WHERE attendee_id = $1",
          [attendee.id],
        );
        await block.release();
        check = await reading;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      // As it was before the revocation, whole: the next look sees it gone.
      expect(check).toMatchObject({ admitted: true });
      expect(
        await app.get(AttendeeSessions).byId(session?.id ?? ""),
      ).toBeUndefined();
    });
  },
);
