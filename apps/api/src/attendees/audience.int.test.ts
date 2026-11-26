import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  AttendeeInvitation,
  AttendeePage,
  ProblemDetails,
  StaffAttendee,
} from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

let addressCounter = 0;
const newAddress = () => `198.18.0.${String((addressCounter += 1) % 250)}`;

describe("the audience, as staff see it (docs/04, section 3.4)", () => {
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

  const client = () => new ApiClient(app, newAddress());
  const visitor = () => new PublicClient(app, newAddress());

  /** An Owner with an open event of the given mode. */
  async function setUp(mode: "PUBLIC" | "INVITE_ONLY" = "PUBLIC") {
    const api = client();
    const owner = await api.newOwner();
    const event = await openEvent(api, owner, { mode });
    return { api, owner, event };
  }

  /** Registers and verifies an address; returns its attendee ID and client. */
  async function attendee(slug: string, email = uniqueEmail("att")) {
    const browser = visitor();
    await browser.register(slug, registration(email));
    const { attendee } = await browser.verify(
      tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
    );
    if (attendee === undefined) {
      throw new Error("Verification failed");
    }
    const [row] = await database.query<{ id: string }>(
      "SELECT id FROM attendees WHERE email = $1",
      [email],
    );
    return { id: row?.id ?? "", email, browser: attendee };
  }

  const list = (
    api: ApiClient,
    session: TestSession,
    eventId: string,
    q = "",
  ) => api.get(session, `/events/${eventId}/attendees${q}`);

  describe("the attendee list", () => {
    it("shows Managers the addresses and Analysts only a hint of them", async () => {
      const { api, owner, event } = await setUp();
      const { email } = await attendee(event.slug);
      const analyst = await memberOf(api, mailer, owner, "ANALYST");

      const forOwner = AttendeePage.parse(
        (await list(api, owner, event.id)).body,
      );
      const forAnalyst = AttendeePage.parse(
        (await list(api, analyst, event.id)).body,
      );

      expect(forOwner.items[0]).toMatchObject({
        email,
        status: "VERIFIED",
        name: "Ada Lovelace",
      });
      expect(forAnalyst.items[0]?.email).toBe(
        `${email.slice(0, 1)}***@${email.split("@")[1] ?? ""}`,
      );
    });

    it("filters by status and pages by cursor, newest first", async () => {
      const { api, owner, event } = await setUp();
      const first = await attendee(event.slug);
      const second = await attendee(event.slug);
      await visitor().register(event.slug, registration(uniqueEmail("pend")));

      const pending = AttendeePage.parse(
        (await list(api, owner, event.id, "?status=PENDING")).body,
      );
      const page1 = AttendeePage.parse(
        (await list(api, owner, event.id, "?status=VERIFIED&limit=1")).body,
      );
      const page2 = AttendeePage.parse(
        (
          await list(
            api,
            owner,
            event.id,
            `?status=VERIFIED&limit=1&cursor=${page1.nextCursor ?? ""}`,
          )
        ).body,
      );

      expect(pending.items).toHaveLength(1);
      expect(page1.items.map(({ id }) => id)).toEqual([second.id]);
      expect(page2.items.map(({ id }) => id)).toEqual([first.id]);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe("revoking an attendee (FR-AD-4)", () => {
    it("refuses their next request, audits it without their address, and does it once", async () => {
      const { api, owner, event } = await setUp();
      const { id, email, browser } = await attendee(event.slug);
      expect(
        (await browser.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(200);

      const revoked = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/revoke`,
      );
      const again = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/revoke`,
      );

      expect(revoked.status).toBe(200);
      expect(StaffAttendee.parse(revoked.body).status).toBe("REVOKED");
      expect(again.status).toBe(200);
      expect(
        (await browser.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(401);
      const audit = await database.query<{ action: string; text: string }>(
        `SELECT action, coalesce(before::text, '') || coalesce(after::text, '') AS text
         FROM audit_entries WHERE target_id = $1`,
        [id],
      );
      expect(audit.map(({ action }) => action)).toEqual(["attendee.revoked"]);
      expect(audit.map(({ text }) => text).join("")).not.toContain(email);
    });

    /** A registered, unverified attendee and the token of their link. */
    async function pendingAttendee(slug: string) {
      const email = uniqueEmail("racing");
      const browser = visitor();
      await browser.register(slug, registration(email));
      const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
      const [row] = await database.query<{ id: string }>(
        "SELECT id FROM attendees WHERE email = $1",
        [email],
      );
      return { browser, token, id: row?.id ?? "" };
    }

    it("leaves no working session when the link is used just before the revocation", async () => {
      const { api, owner, event } = await setUp();
      const { browser, token, id } = await pendingAttendee(event.slug);
      // The verification holds the attendee and waits to store its session...
      const block = await blockWrites(database.url, "attendee_sessions");
      const verification = browser.verify(token);
      await block.waitForWaiters(1);
      // ...so the revocation waits for the attendee, then ends the session.
      const revocation = Promise.resolve(
        api.send(owner, "post", `/events/${event.id}/attendees/${id}/revoke`),
      );
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }

      const { response, attendee: session } = await verification;
      expect(response.status).toBe(200);
      expect((await revocation).status).toBe(200);
      expect(
        (await session?.get(`/public/events/${event.slug}/me`))?.status,
      ).toBe(401);
    });

    it("refuses the link, without a deadlock, when it is used while the revocation runs", async () => {
      const { api, owner, event } = await setUp();
      const { browser, token, id } = await pendingAttendee(event.slug);
      // The revocation holds the attendee and waits to end its sessions...
      const block = await blockWrites(database.url, "attendee_sessions");
      const revocation = Promise.resolve(
        api.send(owner, "post", `/events/${event.id}/attendees/${id}/revoke`),
      );
      await block.waitForWaiters(1);
      // ...so the verification waits for the attendee before it touches
      // the link, and then finds the link gone.
      const verification = browser.verify(token);
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }

      expect((await revocation).status).toBe(200);
      const { response } = await verification;
      expect(response.status, response.text).toBe(400);
      expect(ProblemDetails.parse(response.body).code).toBe("TOKEN_INVALID");
      const sessions = await database.query(
        "SELECT id FROM attendee_sessions WHERE attendee_id = $1",
        [id],
      );
      expect(sessions).toHaveLength(0);
    });

    it("is refused once the event is archived", async () => {
      const { api, owner, event } = await setUp();
      const { id } = await attendee(event.slug);
      for (const to of ["CANCELLED", "ARCHIVED"]) {
        await api.send(owner, "post", `/events/${event.id}/transitions`, {
          to,
        });
      }

      const response = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/revoke`,
      );

      expect(response.status).toBe(409);
      expect(ProblemDetails.parse(response.body).code).toBe("EVENT_ARCHIVED");
    });
  });

  describe("erasing an attendee (FR-AD-6)", () => {
    it("anonymises them at once and removes everything that could reach them", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("erase");
      await api.send(owner, "post", `/events/${event.id}/invitations`, {
        email,
      });
      const { id, browser } = await attendee(event.slug, email);
      await browser.register(event.slug, registration(email));

      const erased = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/erase`,
      );

      expect(erased.status).toBe(200);
      expect(StaffAttendee.parse(erased.body)).toMatchObject({
        name: "Former attendee",
        email: null,
        status: "ERASED",
        remindersOptIn: false,
      });
      const [row] = await database.query<{ email: string; name: string }>(
        "SELECT email::text AS email, name FROM attendees WHERE id = $1",
        [id],
      );
      expect(row?.email).toMatch(/^[0-9a-f]{32}@anonymised\.invalid$/);
      for (const table of [
        "attendee_sessions",
        "attendee_verification_tokens",
        "demo_inbox_messages",
      ]) {
        const left = await database.query(
          `SELECT 1 FROM ${table} WHERE attendee_id = $1`,
          [id],
        );
        expect(left, table).toHaveLength(0);
      }
      const invitations = await database.query(
        "SELECT 1 FROM attendee_invitations WHERE email = $1",
        [email],
      );
      expect(invitations).toHaveLength(0);
      const everything = await database.query<{ text: string }>(
        `SELECT row_to_json(audit_entries)::text AS text FROM audit_entries
         WHERE event_id = $1`,
        [event.id],
      );
      expect(everything.map(({ text }) => text).join("")).not.toContain(email);
      expect(
        (await browser.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(401);
    });

    it("works once the event is archived, and erasing again changes nothing", async () => {
      const { api, owner, event } = await setUp();
      const { id } = await attendee(event.slug);
      for (const to of ["CANCELLED", "ARCHIVED"]) {
        await api.send(owner, "post", `/events/${event.id}/transitions`, {
          to,
        });
      }

      const first = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/erase`,
      );
      const second = await api.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${id}/erase`,
      );

      expect([first.status, second.status]).toEqual([200, 200]);
      const audit = await database.query(
        "SELECT 1 FROM audit_entries WHERE target_id = $1",
        [id],
      );
      expect(audit).toHaveLength(1);
    });
  });

  describe("invitations (FR-AD-4)", () => {
    it("invites an address once, which can then register", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("guest");

      const first = await api.send(
        owner,
        "post",
        `/events/${event.id}/invitations`,
        { email },
      );
      const again = await api.send(
        owner,
        "post",
        `/events/${event.id}/invitations`,
        { email },
      );

      expect(first.status).toBe(201);
      expect(AttendeeInvitation.parse(again.body).id).toBe(
        AttendeeInvitation.parse(first.body).id,
      );
      expect(mailer.to(email).map(({ subject }) => subject)).toEqual([
        `You're invited to ${event.title}`,
      ]);
      expect(mailer.to(email)[0]?.text).toContain(`/e/${event.slug}`);
      await attendee(event.slug, email);
      const listed = await api.get(owner, `/events/${event.id}/invitations`);
      expect(
        (listed.body as unknown[]).map(
          (item) => AttendeeInvitation.parse(item).email,
        ),
      ).toEqual([email]);
    });

    it("creates one invitation when an address is invited twice at the same moment", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("double");
      // The first holds the event and waits to insert; the second waits for
      // the event.
      const block = await blockWrites(database.url, "attendee_invitations");
      const both = [0, 1].map(() =>
        Promise.resolve(
          api.send(owner, "post", `/events/${event.id}/invitations`, { email }),
        ),
      );
      try {
        await block.waitForWaiters(2);
      } finally {
        await block.release();
      }

      const responses = await Promise.all(both);
      expect(responses.map(({ status }) => status)).toEqual([201, 201]);
      expect(
        new Set(responses.map(({ body }) => AttendeeInvitation.parse(body).id))
          .size,
      ).toBe(1);
      expect(mailer.to(email)).toHaveLength(1);
    });

    it("revoking an invitation revokes the attendee who registered with it", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("dropped");
      const invited = AttendeeInvitation.parse(
        (
          await api.send(owner, "post", `/events/${event.id}/invitations`, {
            email,
          })
        ).body,
      );
      const { id, browser } = await attendee(event.slug, email);

      const deleted = await api.send(
        owner,
        "delete",
        `/event-invitations/${invited.id}`,
      );
      const again = await api.send(
        owner,
        "delete",
        `/event-invitations/${invited.id}`,
      );

      expect([deleted.status, again.status]).toEqual([204, 204]);
      expect(
        (await browser.get(`/public/events/${event.slug}/me`)).status,
      ).toBe(401);
      const [row] = await database.query<{ status: string }>(
        "SELECT status::text AS status FROM attendees WHERE id = $1",
        [id],
      );
      expect(row?.status).toBe("REVOKED");
      expect(
        (await api.get(owner, `/events/${event.id}/invitations`)).body,
      ).toEqual([]);
    });
  });

  describe("roles and workspaces", () => {
    it("lets Analysts read the list but change nothing", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("guest");
      await api.send(owner, "post", `/events/${event.id}/invitations`, {
        email,
      });
      const { id } = await attendee(event.slug, email);
      const analyst = await memberOf(api, mailer, owner, "ANALYST");

      const attempts = [
        api.send(analyst, "post", `/events/${event.id}/attendees/${id}/revoke`),
        api.send(analyst, "post", `/events/${event.id}/attendees/${id}/erase`),
        api.get(analyst, `/events/${event.id}/invitations`),
        api.send(analyst, "post", `/events/${event.id}/invitations`, {
          email: uniqueEmail(),
        }),
      ];

      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(403);
      }
      expect((await list(api, analyst, event.id)).status).toBe(200);
      // Nor can they revoke an invitation, nor its attendee with it.
      const [invitation] = await database.query<{ id: string }>(
        "SELECT id FROM attendee_invitations WHERE email = $1",
        [email],
      );
      const deleted = await api.send(
        analyst,
        "delete",
        `/event-invitations/${invitation?.id ?? ""}`,
      );
      expect(deleted.status).toBe(403);
      const [after] = await database.query<{
        revoked_at: Date | null;
        status: string;
      }>(
        `SELECT invitation.revoked_at, attendee.status::text AS status
         FROM attendee_invitations AS invitation, attendees AS attendee
         WHERE invitation.id = $1 AND attendee.id = $2`,
        [invitation?.id, id],
      );
      expect(after).toEqual({ revoked_at: null, status: "VERIFIED" });
    });

    it("answers another workspace as if the event and its attendees did not exist", async () => {
      const { api, owner, event } = await setUp("INVITE_ONLY");
      const email = uniqueEmail("guest");
      await api.send(owner, "post", `/events/${event.id}/invitations`, {
        email,
      });
      const { id } = await attendee(event.slug, email);
      const invitation = AttendeeInvitation.parse(
        (
          await api.send(owner, "post", `/events/${event.id}/invitations`, {
            email: uniqueEmail(),
          })
        ).body,
      );
      const stranger = await client().newOwner();
      const own = await openEvent(api, stranger);

      const attempts = [
        list(api, stranger, event.id),
        api.send(
          stranger,
          "post",
          `/events/${event.id}/attendees/${id}/revoke`,
        ),
        api.send(stranger, "post", `/events/${event.id}/attendees/${id}/erase`),
        // The attendee, reached through an event of the stranger's own.
        api.send(stranger, "post", `/events/${own.id}/attendees/${id}/revoke`),
        api.send(stranger, "post", `/events/${own.id}/attendees/${id}/erase`),
        api.get(stranger, `/events/${event.id}/invitations`),
        api.send(stranger, "post", `/events/${event.id}/invitations`, {
          email: uniqueEmail(),
        }),
        api.send(stranger, "delete", `/event-invitations/${invitation.id}`),
      ];

      for (const response of await Promise.all(attempts)) {
        expect(response.status, response.text).toBe(404);
      }
      const [row] = await database.query<{ status: string }>(
        "SELECT status::text AS status FROM attendees WHERE id = $1",
        [id],
      );
      expect(row?.status).toBe("VERIFIED");
      expect(
        (await api.get(owner, `/events/${event.id}/invitations`)).body,
      ).toHaveLength(2);
    });
  });
});
