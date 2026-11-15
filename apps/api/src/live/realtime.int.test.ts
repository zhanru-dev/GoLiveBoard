import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { ChannelJoined, ChatEvent, Member } from "@opspilot/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { AttendeeSessions } from "../attendees/attendee-sessions.js";
import { ATTENDEE_SESSION_LIMIT } from "../attendees/registration.service.js";
import { RetentionJob } from "../attendees/retention-job.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { hashToken } from "../auth/tokens.js";
import {
  openEvent,
  type PolicyBody,
  PublicClient,
  registration,
} from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import { cookieHeader, setCookies } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { memberOf, prepareForLaunch } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import {
  createTestApp,
  createTestWorker,
  TEST_ORIGIN,
} from "../testing/test-app.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "../demo/demo-accounts.js";
import { DemoSeeder } from "../demo/demo-seeder.js";
import { DEMO_SESSION_LIMIT } from "../demo/demo-workspace.js";
import { Participants } from "./participants.js";
import { RealtimeSignals } from "./realtime-signals.js";
import {
  CONNECTIONS_PER_SESSION,
  MESSAGES_PER_WINDOW,
} from "./realtime.gateway.js";

/** FR-AD-4: a revocation ends live interaction within this long. */
const REVOCATION_MS = 5_000;

let addressCounter = 0;
const newAddress = () => `198.18.1.${String((addressCounter += 1) % 250)}`;

const staffCookie = (session: TestSession) =>
  cookieHeader({ [ACCESS_COOKIE]: session.access });

/** Holds the next call at a chosen point until the test releases it. */
class Gate {
  private armed?: {
    reached: PromiseWithResolvers<undefined>;
    released: PromiseWithResolvers<undefined>;
  };

  arm() {
    const armed = {
      reached: Promise.withResolvers<undefined>(),
      released: Promise.withResolvers<undefined>(),
    };
    this.armed = armed;
    return {
      reached: armed.reached.promise,
      release: () => {
        armed.released.resolve(undefined);
      },
    };
  }

  async pass(): Promise<void> {
    const armed = this.armed;
    if (armed === undefined) {
      return;
    }
    this.armed = undefined;
    armed.reached.resolve(undefined);
    await armed.released.promise;
  }
}

const joinGate = new Gate();
const handshakeGate = new Gate();

/** Decides a join, then pauses before the gateway acts on the decision. */
class GatedParticipants extends Participants {
  override async authorize(
    ...args: Parameters<Participants["authorize"]>
  ): ReturnType<Participants["authorize"]> {
    const decision = await super.authorize(...args);
    await joinGate.pass();
    return decision;
  }
}

/** Loads a handshake's attendee session, then pauses. */
class GatedAttendeeSessions extends AttendeeSessions {
  override async byToken(
    token: string,
  ): ReturnType<AttendeeSessions["byToken"]> {
    const check = await super.byToken(token);
    await handshakeGate.pass();
    return check;
  }
}

async function expectEnded(
  client: RealtimeClient,
  reason: "SIGNED_OUT" | "ACCESS_REVOKED",
): Promise<void> {
  await client.untilDisconnected(REVOCATION_MS);
  expect(client.revoked).toEqual([{ reason }]);
}

/** The error code a refused connection carries. */
async function refusal(connecting: Promise<RealtimeClient>): Promise<string> {
  try {
    (await connecting).close();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("The connection was accepted");
}

describe(
  "the real-time gateway (docs/04, section 4)",
  { timeout: 30_000 },
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;
    let url: string;
    const mailer = new CapturingMailer();
    const clients: RealtimeClient[] = [];

    const env = () => ({
      DATABASE_URL: database.url,
      VALKEY_URL: inject("valkeyUrl"),
      TRUST_PROXY_HOPS: "1",
    });

    beforeAll(async () => {
      database = await createTestDatabase();
      app = await createTestApp({ env: env(), mailer });
      url = await listen(app);
    });

    afterAll(async () => {
      for (const client of clients) {
        client.close();
      }
      await app.close();
      await database.drop();
    });

    const api = () => new ApiClient(app, newAddress());

    async function connect(
      cookie: string | undefined,
      options: { origin?: string; ip?: string; at?: string } = {},
    ): Promise<RealtimeClient> {
      const client = await RealtimeClient.connect(options.at ?? url, {
        cookie,
        origin: options.origin,
        ip: options.ip ?? newAddress(),
      });
      clients.push(client);
      return client;
    }

    /** An Owner with an open event. */
    async function setUp(policy?: PolicyBody) {
      const client = api();
      const owner = await client.newOwner();
      const event = await openEvent(client, owner, policy);
      return { api: client, owner, event };
    }

    /** Registers and verifies an address; returns the attendee and a browser. */
    async function attendee(
      slug: string,
      email = uniqueEmail("att"),
      on: NestExpressApplication = app,
    ) {
      const browser = new PublicClient(on, newAddress());
      await browser.register(slug, registration(email));
      const verified = await browser.verify(
        tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
      );
      const token = verified.attendee?.cookie(ATTENDEE_COOKIE);
      if (verified.attendee === undefined || token === undefined) {
        throw new Error(`Verification failed: ${verified.response.text}`);
      }
      const [row] = await database.query<{ id: string }>(
        "SELECT id FROM attendees WHERE email = $1",
        [email],
      );
      return {
        id: row?.id ?? "",
        email,
        browser: verified.attendee,
        cookie: cookieHeader({ [ATTENDEE_COOKIE]: token }),
      };
    }

    /** A connection that joined the event's chat. */
    async function watching(cookie: string, slug: string, at?: string) {
      const client = await connect(cookie, { at });
      const joined = await client.join(slug);
      expect(joined).toMatchObject({ ok: true });
      return client;
    }

    describe("connecting", () => {
      it("refuses a handshake from another site, even with valid cookies", async () => {
        const { owner } = await setUp();

        await expect(
          refusal(
            connect(staffCookie(owner), { origin: "https://evil.example" }),
          ),
        ).resolves.toMatch(/websocket error/i);
      });

      it("refuses a connection without a session, or with an unknown one", async () => {
        await expect(refusal(connect(undefined))).resolves.toBe(
          "UNAUTHENTICATED",
        );
        await expect(
          refusal(connect(cookieHeader({ [ATTENDEE_COOKIE]: "made-up" }))),
        ).resolves.toBe("UNAUTHENTICATED");
        await expect(
          refusal(connect(cookieHeader({ [ACCESS_COOKIE]: "made-up" }))),
        ).resolves.toBe("UNAUTHENTICATED");
      });

      it("refuses an attendee session whose event no longer admits them", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        await client.send(owner, "post", `/events/${event.id}/transitions`, {
          to: "CANCELLED",
        });

        await expect(refusal(connect(visitor.cookie))).resolves.toBe(
          "FORBIDDEN",
        );
      });

      it("limits connections per session, across tabs", async () => {
        const { owner } = await setUp();
        for (let tab = 0; tab < CONNECTIONS_PER_SESSION; tab += 1) {
          await connect(staffCookie(owner));
        }

        await expect(refusal(connect(staffCookie(owner)))).resolves.toBe(
          "RATE_LIMITED",
        );
      });

      it("limits how often one address connects", async () => {
        const ip = newAddress();
        const refusals: string[] = [];
        for (let attempt = 0; attempt < 61; attempt += 1) {
          refusals.push(await refusal(connect(undefined, { ip })));
        }

        expect(
          refusals.slice(0, 60).every((code) => code === "UNAUTHENTICATED"),
        ).toBe(true);
        expect(refusals[60]).toBe("RATE_LIMITED");
      });
    });

    describe("joining a channel", () => {
      it("admits staff of the event's workspace and its attendees, and nobody else", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const analyst = await memberOf(client, mailer, owner, "ANALYST");
        const stranger = await client.newOwner("stranger");
        const other = await setUp();
        const otherVisitor = await attendee(other.event.slug);

        for (const cookie of [
          staffCookie(owner),
          staffCookie(analyst),
          visitor.cookie,
        ]) {
          const joined = ChannelJoined.parse(
            await (await connect(cookie)).join(event.slug),
          );
          expect(joined).toEqual({ ok: true, latestSequence: 0, replay: [] });
        }
        for (const cookie of [staffCookie(stranger), otherVisitor.cookie]) {
          await expect(
            (await connect(cookie)).join(event.slug),
          ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
        }
        await expect(
          (await connect(staffCookie(owner))).join("no-such-event"),
        ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
      });

      it("refuses a malformed join", async () => {
        const { owner } = await setUp();
        const client = await connect(staffCookie(owner));

        for (const payload of [
          null,
          { slug: "x", channel: "CHAT" },
          { slug: "x", channel: "VOICE", afterSequence: 0 },
          { slug: "x", channel: "CHAT", afterSequence: -1 },
        ]) {
          await expect(client.emit("channel.join", payload)).resolves.toEqual({
            ok: false,
            error: "INVALID",
          });
        }
      });

      it("refuses staff an event that takes no part in live interaction", async () => {
        const client = api();
        const owner = await client.newOwner();
        const draft = await client.send(owner, "post", "/events", {
          title: "Draft",
          startsAt: "2027-03-01T18:00:00Z",
          endsAt: "2027-03-01T19:00:00Z",
          timeZone: "Europe/London",
        });
        const slug = z.object({ slug: z.string() }).parse(draft.body).slug;

        await expect(
          (await connect(staffCookie(owner))).join(slug),
        ).resolves.toEqual({ ok: false, error: "CLOSED" });
      });

      it("replays what the client missed, in order, and asks a client that is too far behind to resynchronise", async () => {
        const { owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const message = async (sequence: number, body: string) => {
          const [row] = await database.query<{ id: string }>(
            `INSERT INTO chat_messages
             (event_id, sequence, author_attendee_id, client_message_id, body)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [event.id, sequence, visitor.id, randomUUID(), body],
          );
          await database.query(
            `INSERT INTO realtime_journal (event_id, channel, sequence, kind, entity_id)
           VALUES ($1, 'CHAT', $2, 'MESSAGE_CREATED', $3)`,
            [event.id, sequence, row?.id],
          );
          return row?.id ?? "";
        };
        await message(1, "First");
        const second = await message(2, "Second");
        await message(3, "Third");
        await database.query(
          "UPDATE chat_messages SET body = '', deleted_at = now() WHERE id = $1",
          [second],
        );
        await database.query(
          `INSERT INTO realtime_journal (event_id, channel, sequence, kind, entity_id)
         VALUES ($1, 'CHAT', 4, 'MESSAGE_DELETED', $2)`,
          [event.id, second],
        );
        await database.query(
          "UPDATE events SET chat_sequence = 4 WHERE id = $1",
          [event.id],
        );
        const client = await connect(staffCookie(owner));

        const joined = ChannelJoined.parse(await client.join(event.slug, 1));
        const replay = joined.replay.map((entry) => ChatEvent.parse(entry));

        expect(joined.latestSequence).toBe(4);
        expect(
          replay.map(({ sequence, kind, message: { body, deleted } }) => ({
            sequence,
            kind,
            body,
            deleted,
          })),
        ).toEqual([
          { sequence: 2, kind: "MESSAGE_CREATED", body: "", deleted: true },
          {
            sequence: 3,
            kind: "MESSAGE_CREATED",
            body: "Third",
            deleted: false,
          },
          { sequence: 4, kind: "MESSAGE_DELETED", body: "", deleted: true },
        ]);
        expect(replay[1]?.message.author).toEqual({
          kind: "ATTENDEE",
          name: "Ada Lovelace",
        });
        await expect(client.join(event.slug, 4)).resolves.toEqual({
          ok: true,
          latestSequence: 4,
          replay: [],
        });
        // Knows sequences the channel never gave out (the demo was reset).
        await expect(client.join(event.slug, 5)).resolves.toEqual({
          ok: false,
          error: "RESYNC_REQUIRED",
        });
        await database.query(
          "UPDATE events SET chat_sequence = 600 WHERE id = $1",
          [event.id],
        );
        await expect(client.join(event.slug, 99)).resolves.toEqual({
          ok: false,
          error: "RESYNC_REQUIRED",
        });
      });

      it("limits how many messages one connection sends", async () => {
        const { owner, event } = await setUp();
        const client = await connect(staffCookie(owner));
        const answers = [];
        for (let sent = 0; sent <= MESSAGES_PER_WINDOW; sent += 1) {
          answers.push(await client.join(event.slug));
        }

        expect(
          answers.slice(0, MESSAGES_PER_WINDOW).every((answer) => answer.ok),
        ).toBe(true);
        expect(answers.at(-1)).toEqual({ ok: false, error: "RATE_LIMITED" });
      });
    });

    describe("an attendee's access ends within seconds (FR-AD-4)", () => {
      it("when a Manager revokes them", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);

        await client.send(
          owner,
          "post",
          `/events/${event.id}/attendees/${visitor.id}/revoke`,
        );

        // Revoking deletes the attendee's sessions.
        await expectEnded(live, "SIGNED_OUT");
      });

      it("when a Manager erases them", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);

        await client.send(
          owner,
          "post",
          `/events/${event.id}/attendees/${visitor.id}/erase`,
        );

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when their invitation is revoked", async () => {
        const {
          api: client,
          owner,
          event,
        } = await setUp({
          mode: "INVITE_ONLY",
        });
        const email = uniqueEmail("invited");
        const invited = await client.send(
          owner,
          "post",
          `/events/${event.id}/invitations`,
          { email },
        );
        const visitor = await attendee(event.slug, email);
        const live = await watching(visitor.cookie, event.slug);

        await client.send(
          owner,
          "delete",
          `/event-invitations/${z.object({ id: z.uuid() }).parse(invited.body).id}`,
        );

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when the policy no longer admits them", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);
        const policy = await client.get(
          owner,
          `/events/${event.id}/access-policy`,
        );

        await client
          .send(owner, "put", `/events/${event.id}/access-policy`, {
            mode: "EMAIL_DOMAIN",
            allowedDomains: ["northwind.example"],
            privacyNoticeVersion: "2026-11",
          })
          .set("If-Match", String(policy.headers.etag));

        await expectEnded(live, "ACCESS_REVOKED");
      });

      it("when the event is cancelled, after telling them", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);

        await client.send(owner, "post", `/events/${event.id}/transitions`, {
          to: "CANCELLED",
        });

        await expectEnded(live, "ACCESS_REVOKED");
        expect(live.statuses).toEqual([
          { slug: event.slug, status: "CANCELLED" },
        ]);
      });

      it("when they sign out of this browser", async () => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);

        await visitor.browser.post(`/public/events/${event.slug}/sign-out`);

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when signing in on more browsers ends this one's session", async () => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug);

        for (let browser = 0; browser < ATTENDEE_SESSION_LIMIT; browser += 1) {
          await attendee(event.slug, visitor.email);
        }

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when the retention job anonymises them", async () => {
        const seeded = await seedEvent(database, {
          startsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "COMPLETED",
          retentionDays: 1,
        });
        const visitor = await seedAttendee(database, seeded.eventId);
        const token = randomUUID();
        await database.query(
          `INSERT INTO attendee_sessions (attendee_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 day')`,
          [visitor.id, hashToken(token)],
        );
        const live = await watching(
          cookieHeader({ [ATTENDEE_COOKIE]: token }),
          seeded.slug,
        );
        const worker = await createTestWorker({ env: env() });

        try {
          await worker.get(RetentionJob).run();
          await expectEnded(live, "SIGNED_OUT");
        } finally {
          await worker.close();
        }
      });
    });

    describe("a staff member's access ends within seconds", () => {
      it("when they sign out", async () => {
        const { api: client, owner, event } = await setUp();
        const live = await watching(staffCookie(owner), event.slug);

        await client
          .post("/auth/sign-out", {})
          .set("Cookie", cookieHeader({ [REFRESH_COOKIE]: owner.refresh }));

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when an Owner removes them from the workspace", async () => {
        const { api: client, owner, event } = await setUp();
        const manager = await memberOf(client, mailer, owner, "MANAGER");
        const live = await watching(staffCookie(manager), event.slug);
        const members = z
          .array(Member)
          .parse((await client.get(owner, "/workspace/members")).body);
        const membership = members.find(
          (member) => member.email === manager.email,
        );

        await client.send(
          owner,
          "delete",
          `/workspace/members/${membership?.membershipId ?? ""}`,
        );

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when an Owner signs them out everywhere", async () => {
        const { api: client, owner, event } = await setUp();
        const manager = await memberOf(client, mailer, owner, "MANAGER");
        const live = await watching(staffCookie(manager), event.slug);
        const members = z
          .array(Member)
          .parse((await client.get(owner, "/workspace/members")).body);
        const membership = members.find(
          (member) => member.email === manager.email,
        );

        await client.send(
          owner,
          "post",
          `/workspace/members/${membership?.membershipId ?? ""}/sign-out`,
        );

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when they reset their password", async () => {
        const { api: client, owner, event } = await setUp();
        const live = await watching(staffCookie(owner), event.slug);
        await client.post("/auth/password-reset/request", {
          email: owner.email,
        });

        await client.post("/auth/password-reset/confirm", {
          token: tokenFromEmail(mailer.to(owner.email).at(-1)?.text ?? ""),
          password: "another correct horse battery",
        });

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when their old refresh token comes back after the grace window", async () => {
        const { api: client, owner, event } = await setUp();
        const live = await watching(staffCookie(owner), event.slug);
        const refresh = () =>
          client
            .post("/auth/refresh", {})
            .set("Cookie", cookieHeader({ [REFRESH_COOKIE]: owner.refresh }));
        expect((await refresh()).status).toBe(204);
        await database.query(
          `UPDATE sessions SET rotated_at = rotated_at - interval '1 minute'
         WHERE previous_refresh_token_hash = $1`,
          [hashToken(owner.refresh)],
        );

        expect((await refresh()).status).toBe(401);

        await expectEnded(live, "SIGNED_OUT");
      });

      it("when they switch to another workspace", async () => {
        const { api: client, owner, event } = await setUp();
        const other = await client.newOwner("other");
        await client.send(other, "post", "/workspace/invitations", {
          email: owner.email,
          role: "MANAGER",
        });
        const accept = await client.post("/team-invitations/accept", {
          token: tokenFromEmail(mailer.to(owner.email).at(-1)?.text ?? ""),
        });
        expect(accept.status, accept.text).toBe(204);
        const otherWorkspace = (await client.me(other)).activeWorkspace
          .workspaceId;
        const live = await watching(staffCookie(owner), event.slug);

        await client.send(owner, "put", "/me/active-workspace", {
          workspaceId: otherWorkspace,
        });

        await expectEnded(live, "ACCESS_REVOKED");
      });

      it("but not when their role changes: they stay, with the new rights", async () => {
        const { api: client, owner, event } = await setUp();
        const manager = await memberOf(client, mailer, owner, "MANAGER");
        const live = await watching(staffCookie(manager), event.slug);
        const members = z
          .array(Member)
          .parse((await client.get(owner, "/workspace/members")).body);
        const membership = members.find(
          (member) => member.email === manager.email,
        );

        await client.send(
          owner,
          "patch",
          `/workspace/members/${membership?.membershipId ?? ""}`,
          {
            role: "ANALYST",
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(live.connected).toBe(true);
        expect(live.revoked).toEqual([]);
      });
    });

    it("tells watchers when the event goes live, and keeps them (FR-RN-1)", async () => {
      const { api: client, owner, event } = await setUp();
      await prepareForLaunch(client, database, owner, event.id, new Date());
      const visitor = await attendee(event.slug);
      const live = await watching(visitor.cookie, event.slug);
      for (const to of ["READY", "LIVE"]) {
        const moved = await client.send(
          owner,
          "post",
          `/events/${event.id}/transitions`,
          { to },
        );
        expect(moved.status, moved.text).toBe(200);
      }

      await expect
        .poll(() => live.statuses, { timeout: REVOCATION_MS })
        .toEqual([
          { slug: event.slug, status: "UPCOMING" },
          { slug: event.slug, status: "LIVE" },
        ]);
      expect(live.connected).toBe(true);
    });

    describe("with two API instances", () => {
      let second: NestExpressApplication;
      let secondUrl: string;

      beforeAll(async () => {
        second = await createTestApp({ env: env(), mailer });
        secondUrl = await listen(second);
      });

      afterAll(async () => {
        await second.close();
      });

      it("ends a connection on one instance when the other revokes", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug, secondUrl);

        await client.send(
          owner,
          "post",
          `/events/${event.id}/attendees/${visitor.id}/revoke`,
        );

        await expectEnded(live, "SIGNED_OUT");
      });

      it("counts a session's connections on every instance", async () => {
        const { owner } = await setUp();
        for (let tab = 0; tab < CONNECTIONS_PER_SESSION; tab += 1) {
          await connect(staffCookie(owner), {
            at: tab % 2 === 0 ? url : secondUrl,
          });
        }

        await expect(
          refusal(connect(staffCookie(owner), { at: secondUrl })),
        ).resolves.toBe("RATE_LIMITED");
      });
    });

    it("keeps other instances' clients when one instance shuts down (a rolling deploy)", async () => {
      const leaving = await createTestApp({ env: env(), mailer });
      const leavingUrl = await listen(leaving);
      const { owner, event } = await setUp();
      const staying = await watching(staffCookie(owner), event.slug);
      const going = await watching(staffCookie(owner), event.slug, leavingUrl);

      await leaving.close();

      await going.untilDisconnected(1_000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(staying.connected).toBe(true);
      expect(await staying.join(event.slug)).toMatchObject({ ok: true });
    });

    describe("the sweep, when no signal comes", () => {
      let swept: NestExpressApplication;
      let sweptUrl: string;

      beforeAll(async () => {
        swept = await createTestApp({
          env: { ...env(), REALTIME_SWEEP_MS: "1000" },
          mailer,
        });
        sweptUrl = await listen(swept);
      });

      afterAll(async () => {
        await swept.close();
      });

      it("ends a connection revoked behind the API's back", async () => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug, sweptUrl);

        await database.query(
          "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE id = $1",
          [visitor.id],
        );

        await expectEnded(live, "ACCESS_REVOKED");
      });

      it("ends a connection whose session expired", async () => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        const live = await watching(visitor.cookie, event.slug, sweptUrl);

        await database.query(
          "UPDATE attendee_sessions SET expires_at = now() WHERE attendee_id = $1",
          [visitor.id],
        );

        await expectEnded(live, "SIGNED_OUT");
      });
    });

    describe("changes that commit while access is being decided", () => {
      let raced: NestExpressApplication;
      let racedUrl: string;

      beforeAll(async () => {
        raced = await createTestApp({
          env: env(),
          mailer,
          replace: [
            [Participants, GatedParticipants],
            [AttendeeSessions, GatedAttendeeSessions],
          ],
        });
        racedUrl = await listen(raced);
      });

      afterAll(async () => {
        await raced.close();
      });

      /** Lets the paused call go on, and the code after it run. */
      async function releaseAndSettle(release: () => void) {
        release();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      it("refuses a join whose event is cancelled after the decision was read", async () => {
        const { api: client, owner, event } = await setUp();
        const live = await connect(staffCookie(owner), { at: racedUrl });
        const join = joinGate.arm();
        const joining = live.join(event.slug);
        await join.reached;
        // The re-check the cancellation causes decides too; hold it as well.
        const recheck = joinGate.arm();

        await client.send(owner, "post", `/events/${event.id}/transitions`, {
          to: "CANCELLED",
        });
        await recheck.reached;
        await releaseAndSettle(recheck.release);
        join.release();

        await expect(joining).resolves.toEqual({ ok: false, error: "CLOSED" });
        expect(live.connected).toBe(true);
      });

      it("only refuses a join it may not make, also while the connection is re-checked", async () => {
        const client = api();
        const owner = await client.newOwner();
        const draft = await client.send(owner, "post", "/events", {
          title: "Draft",
          startsAt: "2027-03-01T18:00:00Z",
          endsAt: "2027-03-01T19:00:00Z",
          timeZone: "Europe/London",
        });
        const slug = z.object({ slug: z.string() }).parse(draft.body).slug;
        const live = await connect(staffCookie(owner), { at: racedUrl });
        const join = joinGate.arm();
        const joining = live.join(slug);
        await join.reached;
        const recheck = joinGate.arm();

        await raced
          .get(RealtimeSignals)
          .recheck("user", [(await client.me(owner)).user.id]);
        await recheck.reached;
        await releaseAndSettle(recheck.release);
        join.release();

        await expect(joining).resolves.toEqual({ ok: false, error: "CLOSED" });
        expect(live.connected).toBe(true);
        expect(live.revoked).toEqual([]);
      });

      it("ends a connection whose attendee is revoked during the handshake", async () => {
        const { api: client, owner, event } = await setUp();
        const visitor = await attendee(event.slug, uniqueEmail("att"), raced);
        const gate = handshakeGate.arm();
        const connecting = connect(visitor.cookie, { at: racedUrl });
        await gate.reached;

        await client.send(
          owner,
          "post",
          `/events/${event.id}/attendees/${visitor.id}/revoke`,
        );
        gate.release();
        const live = await connecting;

        await expectEnded(live, "SIGNED_OUT");
      });
    });

    it("closes the API promptly with connections open (graceful shutdown)", async () => {
      const closing = await createTestApp({ env: env(), mailer });
      const closingUrl = await listen(closing);
      const { owner, event } = await setUp();
      const live = await watching(staffCookie(owner), event.slug, closingUrl);
      const started = Date.now();

      await closing.close();

      expect(Date.now() - started).toBeLessThan(REVOCATION_MS);
      await live.untilDisconnected(1_000);
    });

    describe("in demo mode", () => {
      let demo: NestExpressApplication;
      let demoUrl: string;

      beforeAll(async () => {
        demo = await createTestApp({
          env: {
            ...env(),
            DEMO_MODE: "true",
            S3_ENDPOINT: inject("s3Endpoint"),
            S3_BUCKET: TEST_S3_BUCKET,
            S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
            S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
            S3_FORCE_PATH_STYLE: "true",
            S3_CREATE_BUCKET: "true",
          },
          mailer,
        });
        demoUrl = await listen(demo);
      });

      afterAll(async () => {
        await demo.close();
      });

      async function visitor(): Promise<TestSession> {
        const response = await request(demo.getHttpServer())
          .post("/api/v1/auth/demo")
          .set("Origin", TEST_ORIGIN)
          .set("X-Forwarded-For", newAddress());
        expect(response.status, response.text).toBe(204);
        const cookies = setCookies(response);
        return {
          email: DEMO_PEOPLE.manager.email,
          access: cookies.get(ACCESS_COOKIE)?.value ?? "",
          refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
        };
      }

      async function demoEventSlug(): Promise<string> {
        const [row] = await database.query<{ slug: string }>(
          `SELECT slug FROM events
         WHERE workspace_id = $1 AND status IN ('CONFIGURING', 'READY', 'LIVE')
         ORDER BY slug LIMIT 1`,
          [DEMO_WORKSPACE.id],
        );
        if (row === undefined) {
          throw new Error("The demo has no event to watch");
        }
        return row.slug;
      }

      it("ends visitors' connections to the events a reset deletes", async () => {
        const session = await visitor();
        const live = await watching(
          staffCookie(session),
          await demoEventSlug(),
          demoUrl,
        );

        await demo.get(DemoSeeder).reset();

        await expectEnded(live, "ACCESS_REVOKED");
      });

      it("ends the connection of a visitor session the session limit ends", async () => {
        const session = await visitor();
        const live = await watching(
          staffCookie(session),
          await demoEventSlug(),
          demoUrl,
        );
        // Make it the oldest of a full house.
        await database.query(
          `UPDATE sessions SET created_at = now() - interval '2 hours'
         WHERE refresh_token_hash = $1`,
          [hashToken(session.refresh)],
        );
        await database.query(
          `INSERT INTO sessions
           (user_id, active_workspace_id, refresh_token_hash, refresh_expires_at, created_at)
         SELECT $1, $2, 'full-' || n || '-' || $4, now() + interval '1 day',
                now() - interval '1 hour' + n * interval '1 millisecond'
         FROM generate_series(1, $3::int) AS n`,
          [
            DEMO_PEOPLE.manager.id,
            DEMO_WORKSPACE.id,
            DEMO_SESSION_LIMIT,
            randomUUID(),
          ],
        );

        await visitor();

        await expectEnded(live, "SIGNED_OUT");
      });
    });
  },
);
