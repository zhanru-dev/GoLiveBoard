import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  AttendeeMe,
  DemoInbox,
  ProblemDetails,
  PublicEvent,
} from "@goliveboard/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import {
  ApiClient,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { Mailer, type MailMessage } from "../mail/mailer.js";
import { loadTestConfig } from "../testing/config.js";
import { setCookies } from "../testing/cookies.js";
import {
  blockWrites,
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import {
  NOTICE,
  openEvent,
  PublicClient,
  registration,
} from "../testing/admission.js";
import { createEvent } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp, LogCapture, TEST_ORIGIN } from "../testing/test-app.js";
import { DEMO_ATTENDEE_LIMIT } from "../demo/demo-workspace.js";
import { DEMO_INBOX_COOKIE } from "./attendee-cookies.js";
import { DEMO_INBOX_PER_ATTENDEE } from "./attendee-mail.js";
import { ATTENDEE_SESSION_LIMIT } from "./registration.service.js";
import { unsubscribeToken } from "./unsubscribe-token.js";

let addressCounter = 0;
/** Each test its own client address, so per-address limits never meet. */
const newAddress = () => `192.0.2.${String((addressCounter += 1) % 250)}`;

/** A clock the tests move by hand. */
class ManualClock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
}

describe("registration and verification (FR-AD-1 to FR-AD-3)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();
  const clock = new ManualClock();
  const logs = new LogCapture();

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
    });
    api = new ApiClient(app, newAddress());
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const visitor = () => new PublicClient(app, newAddress());
  /** Each Owner signs up from an address of its own (sign-ups are limited). */
  const newOwner = () => new ApiClient(app, newAddress()).newOwner();

  /** Registers and verifies; returns the attendee's client. */
  async function verifiedAttendee(slug: string, email = uniqueEmail("att")) {
    const client = visitor();
    expect((await client.register(slug, registration(email))).status).toBe(202);
    const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
    const { response, attendee } = await client.verify(token);
    expect(response.status, response.text).toBe(200);
    if (attendee === undefined) {
      throw new Error("Verification set no attendee session");
    }
    return { email, attendee };
  }

  describe("the public event page's data", () => {
    it("shows the event and how to register, with no internal IDs", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner, {
        mode: "EMAIL_DOMAIN",
        allowedDomains: ["example.com"],
      });

      const response = await visitor().get(`/public/events/${event.slug}`);

      expect(response.status).toBe(200);
      expect(PublicEvent.parse(response.body)).toEqual({
        slug: event.slug,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timeZone: event.timeZone,
        status: "UPCOMING",
        registration: {
          open: true,
          mode: "EMAIL_DOMAIN",
          allowedDomains: ["example.com"],
          privacyNoticeVersion: NOTICE,
          retentionDays: 90,
        },
      });
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(event.id);
      expect(text).not.toContain(
        (await api.me(owner)).activeWorkspace.workspaceId,
      );
    });

    it("answers 404 for a draft, an archived event and an unknown slug alike", async () => {
      const owner = await newOwner();
      const draft = await createEvent(api, owner);
      const archived = await openEvent(api, owner);
      for (const to of ["CANCELLED", "ARCHIVED"]) {
        const moved = await api.send(
          owner,
          "post",
          `/events/${archived.id}/transitions`,
          { to },
        );
        expect(moved.status, moved.text).toBe(200);
      }

      for (const slug of [draft.slug, archived.slug, "no-such-event-x1y2"]) {
        const response = await visitor().get(`/public/events/${slug}`);
        expect(response.status).toBe(404);
        expect(ProblemDetails.parse(response.body).code).toBe("NOT_FOUND");
      }
    });
  });

  describe("registration", () => {
    it("answers every registration the same, whatever the address's state (no enumeration)", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner, {
        mode: "EMAIL_DOMAIN",
        allowedDomains: ["example.com"],
      });
      const pending = `pending-${randomUUID()}@example.com`;
      await visitor().register(event.slug, registration(pending));
      const { email: verified } = await verifiedAttendee(
        event.slug,
        `verified-${randomUUID()}@example.com`,
      );
      const revoked = `revoked-${randomUUID()}@example.com`;
      await verifiedAttendee(event.slug, revoked);
      await database.query(
        "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE email = $1",
        [revoked],
      );
      const before = mailer.sent.length;

      const cases = {
        fresh: `fresh-${randomUUID()}@example.com`,
        pending,
        verified,
        revoked,
        ineligible: `outsider-${randomUUID()}@other.net`,
      };
      const responses = await Promise.all(
        Object.values(cases).map((email) =>
          visitor().register(event.slug, registration(email)),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({ status: "accepted" });
        expect(response.headers["content-length"]).toBe(
          responses[0]?.headers["content-length"],
        );
      }
      // Only the mailbox learns anything.
      const sent = mailer.sent.slice(before);
      const subjectTo = (email: string) =>
        sent.filter((message) => message.to === email).map((m) => m.subject);
      expect(subjectTo(cases.fresh)).toEqual([
        `Confirm your registration for ${event.title}`,
      ]);
      expect(subjectTo(cases.pending)).toEqual([
        `Confirm your registration for ${event.title}`,
      ]);
      expect(subjectTo(cases.verified)).toEqual([
        `Your link to ${event.title}`,
      ]);
      expect(subjectTo(cases.revoked)).toEqual([]);
      expect(subjectTo(cases.ineligible)).toEqual([]);
      const [{ count } = { count: -1 }] = await database.query<{
        count: number;
      }>("SELECT count(*)::int AS count FROM attendees WHERE email = $1", [
        cases.ineligible,
      ]);
      expect(count).toBe(0);
    });

    it("records the privacy notice and consent, and refuses a form shown with an older notice", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("consent");

      const stale = await visitor().register(
        event.slug,
        registration(email, { privacyNoticeVersion: "2025-01" }),
      );
      const missingConsent = await visitor().register(
        event.slug,
        registration(email, { consent: false }),
      );
      expect(stale.status).toBe(400);
      expect(ProblemDetails.parse(stale.body).errors?.[0]?.path).toBe(
        "privacyNoticeVersion",
      );
      expect(missingConsent.status).toBe(400);

      expect(
        (await visitor().register(event.slug, registration(email))).status,
      ).toBe(202);
      const [row] = await database.query<{
        consent_notice_version: string;
        consented_at: Date | null;
        reminders_opt_in: boolean;
        status: string;
      }>(
        `SELECT consent_notice_version, consented_at, reminders_opt_in,
                status::text AS status
         FROM attendees WHERE email = $1`,
        [email],
      );
      expect(row).toMatchObject({
        consent_notice_version: NOTICE,
        reminders_opt_in: true,
        status: "PENDING",
      });
      expect(row?.consented_at).toBeInstanceOf(Date);
    });

    it("admits an invitation-only event's invited addresses only", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner, { mode: "INVITE_ONLY" });
      const invited = uniqueEmail("invited");
      const stranger = uniqueEmail("stranger");
      await database.query(
        "INSERT INTO attendee_invitations (event_id, email) VALUES ($1, $2)",
        [event.id, invited],
      );

      await visitor().register(event.slug, registration(invited));
      await visitor().register(event.slug, registration(stranger));

      expect(mailer.to(invited)).toHaveLength(1);
      expect(mailer.to(stranger)).toHaveLength(0);
    });

    it("registers an address once, with one working link, when it registers twice at the same moment", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("twice");
      // Both find no attendee and wait to insert one.
      const block = await blockWrites(database.url, "attendees");
      const both = [visitor(), visitor()].map((client) =>
        Promise.resolve(client.register(event.slug, registration(email))),
      );
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }

      expect((await Promise.all(both)).map(({ status }) => status)).toEqual([
        202, 202,
      ]);
      const rows = await database.query(
        "SELECT id FROM attendees WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      // The event's lock makes them take turns: the second finds the first's
      // attendee and replaces its link, so only the newest link works.
      const links = mailer.to(email).map(({ text }) => tokenFromEmail(text));
      expect(links).toHaveLength(2);
      expect((await visitor().verify(links[0] ?? "")).response.status).toBe(
        400,
      );
      expect((await visitor().verify(links[1] ?? "")).response.status).toBe(
        200,
      );
    });

    it("limits registrations per address", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const client = visitor();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(
          (await client.register(event.slug, registration(uniqueEmail())))
            .status,
        ).toBe(202);
      }

      const over = await client.register(
        event.slug,
        registration(uniqueEmail()),
      );

      expect(over.status).toBe(429);
    });

    it("never writes an attendee's address to the logs", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("private");

      const { attendee } = await verifiedAttendee(event.slug, email);
      await attendee.get(`/public/events/${event.slug}/me`);

      expect(logs.lines.join("\n")).not.toContain(email);
      expect(logs.lines.join("\n")).not.toContain(email.split("@")[0]);
    });
  });

  describe("registration while staff change the event (FR-AD-2)", () => {
    /**
     * Holds the event's row, as a Manager's change does, while a
     * registration starts; makes the change in that transaction; then lets
     * the registration go on. It must decide under the change.
     */
    async function registerDuring(
      event: { id: string; slug: string },
      email: string,
      change: string,
      values: readonly unknown[],
    ) {
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      const registration_ = Promise.resolve(
        visitor().register(event.slug, registration(email)),
      );
      try {
        await block.waitForWaiters(1);
        await block.run(change, values);
      } finally {
        await block.release();
      }
      return registration_;
    }

    async function expectNotRegistered(email: string) {
      const rows = await database.query(
        "SELECT 1 FROM attendees WHERE email = $1",
        [email],
      );
      expect(rows).toEqual([]);
      expect(mailer.to(email)).toEqual([]);
    }

    it("refuses an address a policy made stricter at the same moment no longer admits", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("late-policy");

      const response = await registerDuring(
        event,
        email,
        `UPDATE access_policies SET mode = 'EMAIL_DOMAIN',
           allowed_domains = ARRAY['partner.org'] WHERE event_id = $1`,
        [event.id],
      );

      expect(response.status).toBe(202);
      await expectNotRegistered(email);
    });

    it("refuses a registration for an event cancelled at the same moment", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("late-cancel");

      const response = await registerDuring(
        event,
        email,
        "UPDATE events SET status = 'CANCELLED' WHERE id = $1",
        [event.id],
      );

      expect(response.status).toBe(202);
      await expectNotRegistered(email);
    });

    it("refuses an address whose invitation is revoked at the same moment", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner, { mode: "INVITE_ONLY" });
      const email = uniqueEmail("late-invite");
      await database.query(
        "INSERT INTO attendee_invitations (event_id, email) VALUES ($1, $2)",
        [event.id, email],
      );

      const response = await registerDuring(
        event,
        email,
        "UPDATE attendee_invitations SET revoked_at = now() WHERE event_id = $1",
        [event.id],
      );

      expect(response.status).toBe(202);
      await expectNotRegistered(email);
    });
  });

  describe("what one attendee can pile up (the demo invites anyone to try)", () => {
    it("keeps one unused link and a few sessions however often a verified address registers and signs in", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("repeat");
      for (let round = 0; round < ATTENDEE_SESSION_LIMIT + 2; round += 1) {
        await visitor().register(event.slug, registration(email));
        const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
        expect((await visitor().verify(token)).response.status).toBe(200);
      }
      // One more registration: a link that is not used.
      await visitor().register(event.slug, registration(email));
      await visitor().register(event.slug, registration(email));

      const [attendee] = await database.query<{ id: string }>(
        "SELECT id FROM attendees WHERE email = $1",
        [email],
      );
      const links = await database.query<{ used_at: Date | null }>(
        "SELECT used_at FROM attendee_verification_tokens WHERE attendee_id = $1",
        [attendee?.id],
      );
      expect(links).toEqual([{ used_at: null }]);
      const sessions = await database.query(
        "SELECT 1 FROM attendee_sessions WHERE attendee_id = $1",
        [attendee?.id],
      );
      expect(sessions).toHaveLength(ATTENDEE_SESSION_LIMIT);
    });
  });

  describe("verification", () => {
    it("verifies the address, signs the attendee in, and stores only hashes", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("verify");
      const client = visitor();
      await client.register(event.slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");

      const { response, attendee } = await client.verify(token);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ slug: event.slug });
      const cookie = setCookies(response).get("__Host-goliveboard_attendee");
      expect(cookie?.attributes).toMatchObject({
        path: "/",
        httponly: "",
        secure: "",
        samesite: "Lax",
      });
      const me = await attendee?.get(`/public/events/${event.slug}/me`);
      expect(me?.status).toBe(200);
      expect(AttendeeMe.parse(me?.body)).toEqual({
        slug: event.slug,
        name: "Ada Lovelace",
        remindersOptIn: true,
      });
      const stored = await database.query<{ token_hash: string }>(
        `SELECT token_hash FROM attendee_verification_tokens
         UNION ALL SELECT token_hash FROM attendee_sessions`,
      );
      for (const { token_hash } of stored) {
        expect(token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(token_hash).not.toBe(token);
        expect(token_hash).not.toBe(cookie?.value);
      }
    });

    it("works once (FR-AD-3)", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("once");
      await visitor().register(event.slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");

      expect((await visitor().verify(token)).response.status).toBe(200);
      const again = await visitor().verify(token);

      expect(again.response.status).toBe(400);
      expect(ProblemDetails.parse(again.response.body).code).toBe(
        "TOKEN_INVALID",
      );
    });

    it.each([
      [
        "a Manager makes the policy stricter",
        "PUBLIC",
        `UPDATE access_policies SET mode = 'EMAIL_DOMAIN',
           allowed_domains = ARRAY['partner.org'] WHERE event_id = $1`,
      ],
      [
        "a Manager cancels the event",
        "PUBLIC",
        "UPDATE events SET status = 'CANCELLED' WHERE id = $1",
      ],
      [
        "a Manager revokes the invitation",
        "INVITE_ONLY",
        "UPDATE attendee_invitations SET revoked_at = now() WHERE event_id = $1",
      ],
    ] as const)(
      "refuses a link used while %s, and starts no session",
      async (_label, mode, change) => {
        const owner = await newOwner();
        const event = await openEvent(api, owner, { mode });
        const email = uniqueEmail("verify-race");
        if (mode === "INVITE_ONLY") {
          await database.query(
            "INSERT INTO attendee_invitations (event_id, email) VALUES ($1, $2)",
            [event.id, email],
          );
        }
        await visitor().register(event.slug, registration(email));
        const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
        // The Manager's change holds the event's row; the verification
        // waits for it, then decides under the change.
        const block = await holdLock(
          database.url,
          "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
          [event.id],
        );
        const verification = visitor().verify(token);
        try {
          await block.waitForWaiters(1);
          await block.run(change, [event.id]);
        } finally {
          await block.release();
        }

        const { response, attendee } = await verification;
        expect(response.status, response.text).toBe(403);
        expect(attendee).toBeUndefined();
        const sessions = await database.query(
          `SELECT 1 FROM attendee_sessions WHERE attendee_id =
             (SELECT id FROM attendees WHERE email = $1)`,
          [email],
        );
        expect(sessions).toEqual([]);
      },
    );

    it("works once when two browsers use the link at the same moment", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("race");
      await visitor().register(event.slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
      // Both wait to spend the token, which this holds.
      const block = await holdLock(
        database.url,
        `SELECT id FROM attendee_verification_tokens
         WHERE attendee_id = (SELECT id FROM attendees WHERE email = $1)
         FOR UPDATE`,
        [email],
      );
      const both = [visitor(), visitor()].map((client) =>
        client.verify(token).then(({ response }) => response.status),
      );
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }

      expect((await Promise.all(both)).sort()).toEqual([200, 400]);
      const sessions = await database.query(
        `SELECT id FROM attendee_sessions WHERE attendee_id =
           (SELECT id FROM attendees WHERE email = $1)`,
        [email],
      );
      expect(sessions).toHaveLength(1);
    });

    it("expires after 15 minutes", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("late");
      await visitor().register(event.slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");

      clock.advance(15 * 60 * 1000 + 1000);
      const late = await visitor()
        .verify(token)
        .finally(() => {
          clock.reset();
        });

      expect(late.response.status).toBe(400);
      expect(ProblemDetails.parse(late.response.body).code).toBe(
        "TOKEN_INVALID",
      );
    });

    it("lets only the newest link work after registering again", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("again");
      await visitor().register(event.slug, registration(email));
      const first = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
      await visitor().register(event.slug, registration(email));
      const second = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");

      expect((await visitor().verify(first)).response.status).toBe(400);
      expect((await visitor().verify(second)).response.status).toBe(200);
    });

    it("refuses a link once the attendee was revoked", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const email = uniqueEmail("revoked");
      await visitor().register(event.slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
      await database.query(
        "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE email = $1",
        [email],
      );

      expect((await visitor().verify(token)).response.status).toBe(400);
    });
  });

  describe("the attendee session", () => {
    it("stops working once it expires, and requests do not extend it", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const { email, attendee } = await verifiedAttendee(event.slug);
      const expiry = async () =>
        (
          await database.query<{ expires_at: Date }>(
            `SELECT expires_at FROM attendee_sessions WHERE attendee_id =
               (SELECT id FROM attendees WHERE email = $1)`,
            [email],
          )
        )[0]?.expires_at.getTime();
      const before = await expiry();
      expect(
        (await attendee.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(200);
      expect(await expiry()).toBe(before);

      // The event ends 2026-12-01; the session a day later.
      clock.advance((before ?? 0) - Date.now() + 1000);
      try {
        expect(
          (await attendee.get(`/public/events/${event.slug}/me`)).status,
        ).toBe(401);
        expect(
          (await attendee.post(`/public/events/${event.slug}/sign-out`)).status,
        ).toBe(401);
      } finally {
        clock.reset();
      }
    });

    it.each(["CANCELLED", "ARCHIVED"])(
      "refuses every attendee route once the event is %s",
      async (status) => {
        const owner = await newOwner();
        const event = await openEvent(api, owner);
        const { attendee } = await verifiedAttendee(event.slug);
        for (const to of status === "CANCELLED"
          ? ["CANCELLED"]
          : ["CANCELLED", "ARCHIVED"]) {
          const moved = await api.send(
            owner,
            "post",
            `/events/${event.id}/transitions`,
            { to },
          );
          expect(moved.status, moved.text).toBe(200);
        }

        expect(
          (await attendee.get(`/public/events/${event.slug}/me`)).status,
        ).toBe(403);
        expect(
          (await attendee.post(`/public/events/${event.slug}/sign-out`)).status,
        ).toBe(403);
      },
    );

    it("re-checks eligibility on every request: a stricter policy applies at once (FR-AD-2)", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const { attendee } = await verifiedAttendee(
        event.slug,
        `ada-${randomUUID()}@example.com`,
      );
      const me = () => attendee.get(`/public/events/${event.slug}/me`);
      expect((await me()).status).toBe(200);
      const policy = await api.get(owner, `/events/${event.id}/access-policy`);

      const changed = await api
        .send(owner, "put", `/events/${event.id}/access-policy`, {
          mode: "EMAIL_DOMAIN",
          allowedDomains: ["partner.org"],
          privacyNoticeVersion: NOTICE,
        })
        .set("If-Match", policy.headers.etag ?? "");
      expect(changed.status, changed.text).toBe(200);

      const refused = await me();
      expect(refused.status).toBe(403);
      expect(ProblemDetails.parse(refused.body).code).toBe("FORBIDDEN");
    });

    it("refuses a revoked attendee at once (FR-AD-4)", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const { email, attendee } = await verifiedAttendee(event.slug);

      await database.query(
        "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE email = $1",
        [email],
      );

      expect(
        (await attendee.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(403);
    });

    it("answers another event's routes as if the event did not exist", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const other = await openEvent(api, await newOwner());
      const { attendee } = await verifiedAttendee(event.slug);

      const response = await attendee.get(`/public/events/${other.slug}/me`);

      expect(response.status).toBe(404);
    });

    it("needs a session, and ends with sign-out", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const { attendee } = await verifiedAttendee(event.slug);
      expect(
        (await visitor().get(`/public/events/${event.slug}/me`)).status,
      ).toBe(401);

      const out = await attendee.post(`/public/events/${event.slug}/sign-out`);

      expect(out.status).toBe(204);
      expect(
        (await attendee.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(401);
    });
  });

  describe("unsubscribing from reminders (FR-AD-5)", () => {
    it("stops reminders with the link's token, and refuses a forged one", async () => {
      const owner = await newOwner();
      const event = await openEvent(api, owner);
      const { email, attendee } = await verifiedAttendee(event.slug);
      const [row] = await database.query<{ id: string }>(
        "SELECT id FROM attendees WHERE email = $1",
        [email],
      );
      const secret = loadTestConfig().auth.jwtSecret;
      const genuine = unsubscribeToken(secret, row?.id ?? "");
      const forged = unsubscribeToken("another secret entirely", row?.id ?? "");

      const refused = await visitor().post("/public/reminders/unsubscribe", {
        token: forged,
      });
      const accepted = await visitor().post("/public/reminders/unsubscribe", {
        token: genuine,
      });
      const repeated = await visitor().post("/public/reminders/unsubscribe", {
        token: genuine,
      });

      expect(refused.status).toBe(400);
      expect(accepted.status).toBe(204);
      expect(repeated.status).toBe(204);
      const me = await attendee.get(`/public/events/${event.slug}/me`);
      expect(AttendeeMe.parse(me.body).remindersOptIn).toBe(false);
    });
  });

  describe("the demo inbox", () => {
    it("is not there with demo mode off", async () => {
      expect((await visitor().get("/public/demo-inbox")).status).toBe(404);
    });
  });
});

describe("a mail server that refuses an attendee's address (NFR-2)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  const logs = new LogCapture();
  const refused = `refused-${randomUUID()}@example.com`;

  /** Refuses every message as SMTP servers do: naming the recipient. */
  class RefusingMailer extends Mailer {
    send(message: MailMessage): Promise<void> {
      return Promise.reject(
        Object.assign(
          new Error(
            `Can't send mail - all recipients were rejected: ${message.to}`,
          ),
          {
            code: "EENVELOPE",
            responseCode: 550,
            response: `550 <${message.to}> rejected`,
            rejected: [message.to],
          },
        ),
      );
    }
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
      },
      mailer: new RefusingMailer(),
      logs,
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("logs the failure without the address", async () => {
    const api = new ApiClient(app, newAddress());
    const event = await openEvent(api, await api.newOwner());

    const response = await new PublicClient(app, newAddress()).register(
      event.slug,
      registration(refused),
    );

    expect(response.status).toBe(202);
    await vi.waitFor(() => {
      expect(logs.lines.join("\n")).toContain(
        "Could not send an email to an attendee",
      );
    });
    const failure =
      logs.lines.find((line) =>
        line.includes("Could not send an email to an attendee"),
      ) ?? "";
    expect(failure).toContain("EENVELOPE");
    expect(logs.lines.join("\n")).not.toContain(refused);
    expect(logs.lines.join("\n")).not.toContain(refused.split("@")[0]);
  });
});

describe("registration in the demo workspace (FR-AUTH-5)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
        DEMO_MODE: "true",
      },
      mailer,
    });
    api = new ApiClient(app, newAddress());
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  /** A demo event that is open for registration, made by a demo visitor. */
  async function demoEvent() {
    const signIn = await request(app.getHttpServer())
      .post("/api/v1/auth/demo")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", newAddress());
    expect(signIn.status, signIn.text).toBe(204);
    const cookies = setCookies(signIn);
    const visitorSession = {
      email: "visitor",
      access: cookies.get("__Host-goliveboard_access")?.value ?? "",
      refresh: cookies.get("__Secure-goliveboard_refresh")?.value ?? "",
    };
    return openEvent(api, visitorSession);
  }

  it("sends nothing, and shows the mail in the registering browser's inbox only", async () => {
    const event = await demoEvent();
    const browser = new PublicClient(app, newAddress());
    const email = uniqueEmail("demo");

    const registered = await browser.register(event.slug, registration(email));

    expect(registered.status).toBe(202);
    expect(mailer.to(email)).toHaveLength(0);
    const key = setCookies(registered).get(DEMO_INBOX_COOKIE);
    expect(key?.attributes).toMatchObject({ httponly: "", secure: "" });
    const inbox = DemoInbox.parse(
      (
        await browser
          .with({ [DEMO_INBOX_COOKIE]: key?.value ?? "" })
          .get("/public/demo-inbox")
      ).body,
    );
    expect(inbox.messages.map(({ subject }) => subject)).toEqual([
      `Confirm your registration for ${event.title}`,
    ]);
    // The link in it works.
    const token = tokenFromEmail(inbox.messages[0]?.text ?? "");
    expect((await browser.verify(token)).response.status).toBe(200);
    // Another browser sees nothing, with or without a key of its own.
    const stranger = new PublicClient(app, newAddress());
    expect(
      DemoInbox.parse((await stranger.get("/public/demo-inbox")).body).messages,
    ).toEqual([]);
    expect(
      DemoInbox.parse(
        (
          await stranger
            .with({ [DEMO_INBOX_COOKIE]: "someone-elses-key" })
            .get("/public/demo-inbox")
        ).body,
      ).messages,
    ).toEqual([]);
  });

  it("keeps an address's earlier mail from a browser that registers it again", async () => {
    const event = await demoEvent();
    const email = uniqueEmail("hijack");
    const first = new PublicClient(app, newAddress()).with({
      [DEMO_INBOX_COOKIE]: "first-browser-key",
    });
    const second = new PublicClient(app, newAddress()).with({
      [DEMO_INBOX_COOKIE]: "second-browser-key",
    });
    await first.register(event.slug, registration(email));

    await second.register(event.slug, registration(email));

    const inbox = (client: PublicClient) =>
      client
        .get("/public/demo-inbox")
        .then(({ body }) => DemoInbox.parse(body).messages.length);
    expect(await inbox(first)).toBe(1);
    expect(await inbox(second)).toBe(1);
  });

  // Fills the demo first: more than the default 5 seconds on a slow machine.
  it("keeps a bounded inbox for an address registered again and again, from anywhere", async () => {
    const event = await demoEvent();
    const email = `repeat-${randomUUID()}@northwind.example`;
    const browser = new PublicClient(app, newAddress()).with({
      [DEMO_INBOX_COOKIE]: "a-patient-attacker",
    });
    for (let round = 0; round < DEMO_INBOX_PER_ATTENDEE + 3; round += 1) {
      // From a new address each time: the per-address limit is no bound.
      const response = await new PublicClient(app, newAddress())
        .with({ [DEMO_INBOX_COOKIE]: "a-patient-attacker" })
        .register(event.slug, registration(email));
      expect(response.status).toBe(202);
    }

    const stored = await database.query(
      `SELECT 1 FROM demo_inbox_messages WHERE attendee_id =
         (SELECT id FROM attendees WHERE email = $1)`,
      [email],
    );
    expect(stored).toHaveLength(DEMO_INBOX_PER_ATTENDEE);
    const links = await database.query(
      `SELECT 1 FROM attendee_verification_tokens WHERE used_at IS NULL
         AND attendee_id = (SELECT id FROM attendees WHERE email = $1)`,
      [email],
    );
    expect(links).toHaveLength(1);
    expect(
      DemoInbox.parse((await browser.get("/public/demo-inbox")).body).messages,
    ).toHaveLength(DEMO_INBOX_PER_ATTENDEE);
  });
  it(
    "holds a bounded number of attendees, also when visitors register at the same moment",
    { timeout: 30_000 },
    async () => {
      const event = await demoEvent();
      // The limit counts the whole demo workspace, earlier tests' attendees
      // included.
      const [before] = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM attendees",
      );
      await database.query(
        `INSERT INTO attendees
         (event_id, email, name, consent_notice_version, consented_at)
       SELECT $1, 'filler-' || n || '@example.com', 'Filler', $2, now()
       FROM generate_series(1, $3::int) AS n`,
        [event.id, NOTICE, DEMO_ATTENDEE_LIMIT - 1 - (before?.count ?? 0)],
      );
      // One place left. The first registration holds the demo lock and waits
      // to insert; the other two wait for the lock, then find the demo full.
      const block = await blockWrites(database.url, "attendees");
      const registrations = ["one", "two", "three"].map((label) =>
        Promise.resolve(
          new PublicClient(app, newAddress()).register(
            event.slug,
            registration(uniqueEmail(label)),
          ),
        ),
      );
      try {
        await block.waitForWaiters(3);
      } finally {
        await block.release();
      }

      // Answered like any other registration: nothing reveals that it was full.
      expect(
        (await Promise.all(registrations)).map(({ status }) => status),
      ).toEqual([202, 202, 202]);
      const [row] = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM attendees",
      );
      expect(row?.count).toBe(DEMO_ATTENDEE_LIMIT);
    },
  );
});
