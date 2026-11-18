import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ChatMessage,
  ChatPage,
  type ChatSendAck,
  ProblemDetails,
} from "@opspilot/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "../demo/demo-accounts.js";
import { DEMO_CHAT_MESSAGE_LIMIT } from "../demo/demo-workspace.js";
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
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { cookieHeader, setCookies } from "../testing/cookies.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";

/** FR-RN-2: messages appear for everyone within a second. */
const DELIVERY_MS = 1_000;

let addressCounter = 0;
const newAddress = () => `198.18.2.${String((addressCounter += 1) % 250)}`;

const staffCookie = (session: TestSession) =>
  cookieHeader({ [ACCESS_COOKIE]: session.access });

const sentMessage = (ack: ChatSendAck): ChatMessage => {
  if (!ack.ok) {
    throw new Error(`The message was refused: ${ack.error}`);
  }
  return ack.message;
};

describe("live chat (FR-RN-2, FR-RN-3)", { timeout: 30_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let second: NestExpressApplication;
  let url: string;
  let secondUrl: string;
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
    second = await createTestApp({ env: env(), mailer });
    url = await listen(app);
    secondUrl = await listen(second);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    await app.close();
    await second.close();
    await database.drop();
  });

  const api = () => new ApiClient(app, newAddress());

  async function connect(cookie: string, at = url): Promise<RealtimeClient> {
    const client = await RealtimeClient.connect(at, {
      cookie,
      ip: newAddress(),
    });
    clients.push(client);
    return client;
  }

  /** A connection on the event's chat. */
  async function watching(cookie: string, slug: string, at = url) {
    const client = await connect(cookie, at);
    expect(await client.join(slug)).toMatchObject({ ok: true });
    return client;
  }

  async function setUp(policy?: PolicyBody) {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner, policy);
    return { api: client, owner, event };
  }

  async function attendee(slug: string, email = uniqueEmail("att")) {
    const browser = new PublicClient(app, newAddress());
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
      browser: verified.attendee,
      cookie: cookieHeader({ [ATTENDEE_COOKIE]: token }),
    };
  }

  const storedMessages = (eventId: string) =>
    database.query<{ sequence: string; body: string }>(
      "SELECT sequence::text, body FROM chat_messages WHERE event_id = $1 ORDER BY sequence",
      [eventId],
    );

  describe("sending", () => {
    it("reaches everyone on the chat, on every instance, within a second", async () => {
      const { owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      const sender = await watching(visitor.cookie, event.slug);
      const staff = await watching(staffCookie(owner), event.slug, secondUrl);
      const started = Date.now();

      const message = sentMessage(await sender.send(event.slug, "  Hello!  "));

      expect(message).toMatchObject({
        sequence: 1,
        author: { kind: "ATTENDEE", name: "Ada Lovelace" },
        body: "Hello!",
        deleted: false,
      });
      await expect
        .poll(() => staff.chat, { timeout: DELIVERY_MS, interval: 10 })
        .toEqual([{ sequence: 1, kind: "MESSAGE_CREATED", message }]);
      expect(Date.now() - started).toBeLessThan(DELIVERY_MS);
      await expect.poll(() => sender.chat).toHaveLength(1);
      const [journal] = await database.query(
        "SELECT channel::text, sequence::int, kind, entity_id FROM realtime_journal WHERE event_id = $1",
        [event.id],
      );
      expect(journal).toEqual({
        channel: "CHAT",
        sequence: 1,
        kind: "MESSAGE_CREATED",
        entity_id: message.id,
      });
    });

    it("shows a staff member as staff, by name", async () => {
      const { owner, event } = await setUp();
      const staff = await connect(staffCookie(owner));

      const message = sentMessage(await staff.send(event.slug, "Welcome"));

      expect(message.author).toEqual({ kind: "STAFF", name: "Ada Lovelace" });
    });

    it("stores a retried message once and sends it once", async () => {
      const { owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      const sender = await connect(visitor.cookie);
      const listener = await watching(staffCookie(owner), event.slug);
      const clientMessageId = randomUUID();

      const first = sentMessage(
        await sender.send(event.slug, "Once", clientMessageId),
      );
      // A new connection, as after a reconnect: the same author.
      const again = await connect(visitor.cookie);
      const retried = sentMessage(
        await again.send(event.slug, "Once", clientMessageId),
      );

      expect(retried).toEqual(first);
      expect(await storedMessages(event.id)).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(listener.chat).toHaveLength(1);
    });

    it("keeps one author's client message IDs apart from another's", async () => {
      const { event } = await setUp();
      const clientMessageId = randomUUID();
      const one = await connect((await attendee(event.slug)).cookie);
      const two = await connect((await attendee(event.slug)).cookie);

      await one.send(event.slug, "Mine", clientMessageId);
      await two.send(event.slug, "Mine too", clientMessageId);

      expect(await storedMessages(event.id)).toHaveLength(2);
    });

    it("gives messages sent at the same moment gapless, unique sequences, delivered to all", async () => {
      const { owner, event } = await setUp();
      const senders = await Promise.all(
        Array.from({ length: 6 }, async () =>
          connect((await attendee(event.slug)).cookie),
        ),
      );
      const listener = await watching(
        staffCookie(owner),
        event.slug,
        secondUrl,
      );

      const acks = await Promise.all(
        senders.flatMap((sender, index) =>
          [1, 2, 3].map((round) =>
            sender.send(event.slug, `${String(index)}.${String(round)}`),
          ),
        ),
      );

      const sequences = acks
        .map((ack) => sentMessage(ack).sequence)
        .sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
      const journal = await database.query<{ sequence: number }>(
        "SELECT sequence::int FROM realtime_journal WHERE event_id = $1 ORDER BY sequence",
        [event.id],
      );
      expect(journal.map((row) => row.sequence)).toEqual(sequences);
      await expect
        .poll(() => listener.chat.length, { timeout: DELIVERY_MS })
        .toBe(18);
    });

    it("stores one message when two retries wait for the event at the same moment", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      const [one, two] = [
        await connect(visitor.cookie),
        await connect(visitor.cookie, secondUrl),
      ];
      const clientMessageId = randomUUID();
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let acks: ChatSendAck[];
      try {
        const sending = Promise.all([
          one.send(event.slug, "Twice", clientMessageId),
          two.send(event.slug, "Twice", clientMessageId),
        ]);
        await block.waitForWaiters(2);
        await block.release();
        acks = await sending;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      const [first, retried] = acks.map(sentMessage);
      expect(first).toBeDefined();
      expect(retried).toEqual(first);
      expect(await storedMessages(event.id)).toHaveLength(1);
    });

    it.each([
      [
        "the attendee is revoked",
        "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE event_id = $1",
      ],
      [
        "the event is cancelled",
        "UPDATE events SET status = 'CANCELLED' WHERE id = $1",
      ],
      [
        "the policy is made stricter",
        "UPDATE access_policies SET mode = 'EMAIL_DOMAIN', allowed_domains = '{northwind.example}' WHERE event_id = $1",
      ],
    ])(
      "refuses a message when %s while it waits for the event",
      async (_label, change) => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        const sender = await connect(visitor.cookie);
        const block = await holdLock(
          database.url,
          "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
          [event.id],
        );
        let ack: ChatSendAck;
        try {
          const sending = sender.send(event.slug, "Too late");
          await block.waitForWaiters(1);
          await block.run(change, [event.id]);
          await block.release();
          ack = await sending;
        } catch (failure) {
          await block.release().catch(() => undefined);
          throw failure;
        }

        expect(ack).toEqual({ ok: false, error: "FORBIDDEN" });
        expect(await storedMessages(event.id)).toEqual([]);
      },
    );

    it("refuses a message for an event the sender does not take part in", async () => {
      const { event } = await setUp();
      const stranger = await api().newOwner("stranger");
      const other = await setUp();
      const otherVisitor = await attendee(other.event.slug);

      for (const cookie of [staffCookie(stranger), otherVisitor.cookie]) {
        await expect(
          (await connect(cookie)).send(event.slug, "Not mine"),
        ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
      }
      expect(await storedMessages(event.id)).toEqual([]);
    });

    it("drops a connection that sends more than 16 KiB at once", async () => {
      const { owner, event } = await setUp();
      const staff = await connect(staffCookie(owner));

      void staff.send(event.slug, "x".repeat(20 * 1024)).catch(() => undefined);

      await staff.untilDisconnected(2_000);
      expect(await storedMessages(event.id)).toEqual([]);
    });

    it("gives messages that wait for the event together consecutive sequences", async () => {
      const { event } = await setUp();
      const senders = [];
      for (let index = 0; index < 8; index += 1) {
        senders.push(
          await connect(
            (await attendee(event.slug)).cookie,
            index % 2 === 0 ? url : secondUrl,
          ),
        );
      }
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let acks: ChatSendAck[];
      try {
        const sending = Promise.all(
          senders.map((sender, index) =>
            sender.send(event.slug, `Together ${String(index)}`),
          ),
        );
        await block.waitForWaiters(8);
        await block.release();
        acks = await sending;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      expect(
        acks.map((ack) => sentMessage(ack).sequence).sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("lets Analysts read but not write", async () => {
      const { api: client, owner, event } = await setUp();
      const analyst = await memberOf(client, mailer, owner, "ANALYST");
      const reader = await watching(staffCookie(analyst), event.slug);

      await expect(reader.send(event.slug, "Hi")).resolves.toEqual({
        ok: false,
        error: "FORBIDDEN",
      });
    });

    it("takes no messages once the event has ended", async () => {
      const { owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      await database.query(
        "UPDATE events SET status = 'COMPLETED' WHERE id = $1",
        [event.id],
      );

      for (const cookie of [visitor.cookie, staffCookie(owner)]) {
        await expect(
          (await connect(cookie)).send(event.slug, "Late"),
        ).resolves.toEqual({ ok: false, error: "CLOSED" });
      }
    });

    it("refuses an empty, an overlong or a malformed message", async () => {
      const { owner, event } = await setUp();
      const staff = await connect(staffCookie(owner));

      for (const body of ["", "   ", "x".repeat(1001)]) {
        await expect(staff.send(event.slug, body)).resolves.toEqual({
          ok: false,
          error: "INVALID",
        });
      }
      await expect(
        staff.emit("chat.send", { slug: event.slug, body: "No ID" }),
      ).resolves.toEqual({ ok: false, error: "INVALID" });
      expect(await storedMessages(event.id)).toEqual([]);
    });

    it("limits how fast one author writes, across connections", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      const one = await connect(visitor.cookie);
      const two = await connect(visitor.cookie);

      for (let sent = 0; sent < 20; sent += 1) {
        sentMessage(await (sent % 2 === 0 ? one : two).send(event.slug, "x"));
      }

      await expect(two.send(event.slug, "One more")).resolves.toEqual({
        ok: false,
        error: "RATE_LIMITED",
      });
    });
    it("answers a retry even once the author has reached the limit", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      const sender = await connect(visitor.cookie);
      const clientMessageId = randomUUID();
      const first = sentMessage(
        await sender.send(event.slug, "First", clientMessageId),
      );
      for (let sent = 1; sent < 20; sent += 1) {
        sentMessage(await sender.send(event.slug, "x"));
      }

      await expect(
        sender.send(event.slug, "First", clientMessageId),
      ).resolves.toEqual({ ok: true, message: first });
    });
  });

  describe("deleting (FR-RN-3)", () => {
    async function withMessage() {
      const setup = await setUp();
      const visitor = await attendee(setup.event.slug);
      const sender = await connect(visitor.cookie);
      const message = sentMessage(
        await sender.send(setup.event.slug, "Something rude"),
      );
      return { ...setup, visitor, message };
    }

    const remove = (
      client: ApiClient,
      session: TestSession,
      eventId: string,
      messageId: string,
    ) =>
      client.send(
        session,
        "delete",
        `/events/${eventId}/chat/messages/${messageId}`,
      );

    it("removes the text for everyone, keeps a tombstone and audits it", async () => {
      const { api: client, owner, event, message } = await withMessage();
      const listener = await watching(
        staffCookie(owner),
        event.slug,
        secondUrl,
      );

      const response = await remove(client, owner, event.id, message.id);

      expect(response.status, response.text).toBe(200);
      const tombstone = ChatMessage.parse(response.body);
      expect(tombstone).toEqual({ ...message, body: "", deleted: true });
      // The message's creation may reach the listener too: chat events
      // go out in frames gathered over 100 ms, and it joined within them.
      await expect
        .poll(
          () => listener.chat.filter(({ kind }) => kind === "MESSAGE_DELETED"),
          { timeout: DELIVERY_MS },
        )
        .toEqual([
          { sequence: 2, kind: "MESSAGE_DELETED", message: tombstone },
        ]);
      expect(await storedMessages(event.id)).toEqual([
        { sequence: "1", body: "" },
      ]);
      const audit = await database.query(
        "SELECT action, target_id, event_id, before, after FROM audit_entries WHERE action = 'chat_message.deleted' AND target_id = $1",
        [message.id],
      );
      expect(audit).toEqual([
        {
          action: "chat_message.deleted",
          target_id: message.id,
          event_id: event.id,
          before: null,
          after: null,
        },
      ]);
    });

    it("changes nothing when deleted again", async () => {
      const { api: client, owner, event, message } = await withMessage();
      await remove(client, owner, event.id, message.id);

      const again = await remove(client, owner, event.id, message.id);

      expect(again.status).toBe(200);
      const [row] = await database.query<{ chat_sequence: string }>(
        "SELECT chat_sequence::text FROM events WHERE id = $1",
        [event.id],
      );
      expect(row?.chat_sequence).toBe("2");
    });

    it("is for Managers and Owners of the event's workspace only", async () => {
      const { api: client, owner, event, message } = await withMessage();
      const analyst = await memberOf(client, mailer, owner, "ANALYST");
      const stranger = await client.newOwner("stranger");
      const other = await setUp();

      expect((await remove(client, analyst, event.id, message.id)).status).toBe(
        403,
      );
      expect(
        (await remove(client, stranger, event.id, message.id)).status,
      ).toBe(404);
      // The right workspace, the wrong event.
      expect(
        (await remove(client, other.owner, other.event.id, message.id)).status,
      ).toBe(404);
      expect(
        ProblemDetails.parse(
          (await remove(client, owner, other.event.id, message.id)).body,
        ).code,
      ).toBe("NOT_FOUND");
      expect(await storedMessages(event.id)).toEqual([
        { sequence: "1", body: "Something rude" },
      ]);
    });

    it("cannot be done once the event is archived", async () => {
      const { api: client, owner, event, message } = await withMessage();
      await database.query(
        "UPDATE events SET status = 'ARCHIVED' WHERE id = $1",
        [event.id],
      );

      const response = await remove(client, owner, event.id, message.id);

      expect(ProblemDetails.parse(response.body).code).toBe("EVENT_ARCHIVED");
    });
  });

  describe("history", () => {
    it("pages back through the messages, oldest first, for staff and attendees", async () => {
      const { api: client, owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      const staff = await connect(staffCookie(owner));
      for (let index = 1; index <= 5; index += 1) {
        sentMessage(await staff.send(event.slug, `Message ${String(index)}`));
      }

      const latest = ChatPage.parse(
        (await client.get(owner, `/events/${event.id}/chat/messages?limit=2`))
          .body,
      );
      const older = ChatPage.parse(
        (
          await client.get(
            owner,
            `/events/${event.id}/chat/messages?limit=2&before=${String(latest.nextBefore)}`,
          )
        ).body,
      );
      const oldest = ChatPage.parse(
        (
          await visitor.browser.get(
            `/public/events/${event.slug}/chat/messages?limit=2&before=${String(older.nextBefore)}`,
          )
        ).body,
      );

      expect(latest.items.map(({ body }) => body)).toEqual([
        "Message 4",
        "Message 5",
      ]);
      expect(latest).toMatchObject({ latestSequence: 5, nextBefore: 4 });
      expect(older.items.map(({ body }) => body)).toEqual([
        "Message 2",
        "Message 3",
      ]);
      expect(oldest.items.map(({ body }) => body)).toEqual(["Message 1"]);
      expect(oldest.nextBefore).toBeNull();
    });

    it("shows an erased author as a former attendee, and a deleted message without text", async () => {
      const { api: client, owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      const sender = await connect(visitor.cookie);
      const kept = sentMessage(await sender.send(event.slug, "Kept"));
      const removed = sentMessage(await sender.send(event.slug, "Removed"));
      await client.send(
        owner,
        "delete",
        `/events/${event.id}/chat/messages/${removed.id}`,
      );
      await client.send(
        owner,
        "post",
        `/events/${event.id}/attendees/${visitor.id}/erase`,
      );

      const page = ChatPage.parse(
        (await client.get(owner, `/events/${event.id}/chat/messages`)).body,
      );

      expect(page.items).toEqual([
        { ...kept, author: { kind: "ATTENDEE", name: "Former attendee" } },
        {
          ...removed,
          author: { kind: "ATTENDEE", name: "Former attendee" },
          body: "",
          deleted: true,
        },
      ]);
      expect(page.latestSequence).toBe(3);
    });

    it("is for the event's workspace and its admitted attendees only", async () => {
      const { api: client, event } = await setUp();
      const stranger = await client.newOwner("stranger");
      const other = await setUp();
      const otherVisitor = await attendee(other.event.slug);

      expect(
        (await client.get(stranger, `/events/${event.id}/chat/messages`))
          .status,
      ).toBe(404);
      expect(
        (
          await otherVisitor.browser.get(
            `/public/events/${event.slug}/chat/messages`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await new PublicClient(app, newAddress()).get(
            `/public/events/${event.slug}/chat/messages`,
          )
        ).status,
      ).toBe(401);
    });
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

    it("stores a bounded number of messages per event", async () => {
      const response = await request(demo.getHttpServer())
        .post("/api/v1/auth/demo")
        .set("Origin", TEST_ORIGIN)
        .set("X-Forwarded-For", newAddress());
      const visitor: TestSession = {
        email: DEMO_PEOPLE.manager.email,
        access: setCookies(response).get(ACCESS_COOKIE)?.value ?? "",
        refresh: setCookies(response).get(REFRESH_COOKIE)?.value ?? "",
      };
      const [event] = await database.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM events
         WHERE workspace_id = $1 AND status IN ('CONFIGURING', 'READY', 'LIVE')
         ORDER BY slug LIMIT 1`,
        [DEMO_WORKSPACE.id],
      );
      await database.query(
        `INSERT INTO chat_messages (event_id, sequence, author_user_id, client_message_id, body)
         SELECT $1, n, $2, gen_random_uuid(), 'Filler'
         FROM generate_series(1, $3::int - 1) AS n`,
        [event?.id, DEMO_PEOPLE.manager.id, DEMO_CHAT_MESSAGE_LIMIT],
      );
      await database.query(
        "UPDATE events SET chat_sequence = $2 - 1 WHERE id = $1",
        [event?.id, DEMO_CHAT_MESSAGE_LIMIT],
      );
      const staff = await connect(staffCookie(visitor), demoUrl);

      sentMessage(await staff.send(event?.slug ?? "", "The last one"));
      await expect(
        staff.send(event?.slug ?? "", "One too many"),
      ).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    });
  });
});
