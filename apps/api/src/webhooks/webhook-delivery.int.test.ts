import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookEndpointCreated,
  type WebhookEventType,
} from "@opspilot/contracts";
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
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { TestReceiver } from "../testing/test-receiver.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { SIGNATURE_TOLERANCE_SECONDS, verifySignature } from "./signing.js";
import { WebhookFanOut } from "./webhook-fan-out.js";
import { WebhookSender } from "./webhook-sender.js";
import { WebhooksConsumer } from "../worker/webhooks.consumer.js";

let addressCounter = 0;
const newAddress = () => `198.18.7.${String((addressCounter += 1) % 250)}`;

const MINUTE_MS = 60_000;

interface Webhook {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly data: Record<string, unknown>;
}

describe(
  "webhook delivery (FR-RC-2, docs/04 section 6)",
  { timeout: 60_000 },
  () => {
    let database: TestDatabase;
    let receiver: TestReceiver;
    let app: NestExpressApplication;
    let worker: INestApplicationContext;
    let env: Record<string, string>;
    const clock = new TestClock(new Date());
    const mailer = new CapturingMailer();

    beforeAll(async () => {
      database = await createTestDatabase();
      receiver = await TestReceiver.start();
      env = {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
        // Both processes seal and open with the same key, as in production.
        WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      };
      app = await createTestApp({
        env,
        mailer,
        safeHttp: receiver.clientOptions(),
      });
      worker = await createTestWorker({
        env,
        clock,
        safeHttp: receiver.clientOptions(1_000),
      });
    });

    afterAll(async () => {
      await worker.close();
      await app.close();
      await receiver.stop();
      await database.drop();
    });

    const api = () => new ApiClient(app, newAddress());
    const fanOut = () => worker.get(WebhookFanOut);
    const sendDue = () => worker.get(WebhookSender).sendDue();
    const nowSeconds = () => Math.floor(clock.now().getTime() / 1000);

    async function endpointFor(
      client: ApiClient,
      owner: TestSession,
      eventTypes: WebhookEventType[] = ["event.cancelled"],
      path = "/in",
    ): Promise<WebhookEndpointCreated> {
      const response = await client.send(owner, "post", "/webhook-endpoints", {
        url: receiver.url(path),
        eventTypes,
      });
      expect(response.status, response.text).toBe(201);
      return WebhookEndpointCreated.parse(response.body);
    }

    /** Cancels a fresh event and fans its outbox message out. */
    async function cancelled(client: ApiClient, owner: TestSession) {
      const event = await openEvent(client, owner);
      await client.send(owner, "post", `/events/${event.id}/transitions`, {
        to: "CANCELLED",
      });
      const [message] = await database.query<{ id: string }>(
        `SELECT id FROM outbox_messages
       WHERE type = 'event.transitioned' AND payload->>'eventId' = $1
         AND payload->>'to' = 'CANCELLED'`,
        [event.id],
      );
      const created = await fanOut().fanOut(message?.id ?? "");
      return { event, messageId: message?.id ?? "", created };
    }

    const requestsTo = (path: string) =>
      receiver.requests.filter((request) => request.path === path);

    async function deliveriesOf(
      client: ApiClient,
      owner: TestSession,
      endpointId: string,
    ) {
      return WebhookDeliveryPage.parse(
        (
          await client.get(
            owner,
            `/webhook-deliveries?endpointId=${endpointId}`,
          )
        ).body,
      ).items;
    }

    /** Moves the worker's clock to the delivery's next attempt and sends. */
    async function retry(
      client: ApiClient,
      owner: TestSession,
      endpointId: string,
    ) {
      const [delivery] = await deliveriesOf(client, owner, endpointId);
      const next = Date.parse(delivery?.nextAttemptAt ?? "");
      clock.advance(Math.max(0, next - clock.now().getTime()));
      await sendDue();
    }

    it("signs each webhook, which the receiver verifies and keeps once (the exit criterion)", async () => {
      const client = api();
      const owner = await client.newOwner();
      const { endpoint, secret } = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/exit",
      );
      receiver.answer("/exit", 500);

      const { event, messageId, created } = await cancelled(client, owner);
      await sendDue();
      await retry(client, owner, endpoint.id);
      // Resent by hand: the same webhook, a third time.
      await client.send(
        owner,
        "post",
        `/webhook-deliveries/${(await deliveriesOf(client, owner, endpoint.id))[0]?.id ?? ""}/redeliver`,
      );
      await sendDue();

      expect(created).toBe(1);
      const received = requestsTo("/exit");
      expect(received).toHaveLength(3);
      for (const request of received) {
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.headers["opspilot-event-id"]).toBe(messageId);
        expect(request.headers["opspilot-event-type"]).toBe("event.cancelled");
        expect(
          verifySignature(
            String(request.headers["opspilot-signature"]),
            secret,
            request.body,
            nowSeconds(),
          ),
        ).toBe(true);
      }
      const accepted = receiver.accepted(secret, nowSeconds()) as Webhook[];
      const kept = accepted.filter(({ id }) => id === messageId);
      expect(kept).toHaveLength(1);
      expect(kept[0]).toMatchObject({
        id: messageId,
        type: "event.cancelled",
        workspaceId: (await client.me(owner)).activeWorkspace.workspaceId,
        data: {
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt,
        },
      });
      expect(Date.parse(kept[0]?.occurredAt ?? "")).not.toBeNaN();
      // Signed with another secret, or changed on the way: refused.
      expect(receiver.accepted(`${secret}x`, nowSeconds())).toEqual([]);
      expect(
        verifySignature(
          String(received[0]?.headers["opspilot-signature"]),
          secret,
          `${received[0]?.body ?? ""} `,
          nowSeconds(),
        ),
      ).toBe(false);
      expect(
        verifySignature(
          String(received[0]?.headers["opspilot-signature"]),
          secret,
          received[0]?.body ?? "",
          nowSeconds() + SIGNATURE_TOLERANCE_SECONDS + 3 * 3600,
        ),
      ).toBe(false);
    });

    it("records each attempt, retries a failure on the schedule and gives up after five", async () => {
      const client = api();
      const owner = await client.newOwner();
      const { endpoint } = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/fails",
      );
      receiver.answer("/fails", 500, 503, 404, 500, 500);

      await cancelled(client, owner);
      await sendDue();
      const first = (await deliveriesOf(client, owner, endpoint.id))[0];
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        await retry(client, owner, endpoint.id);
      }

      expect(first).toMatchObject({ status: "PENDING", attempts: 1 });
      const gap =
        Date.parse(first?.nextAttemptAt ?? "") -
        Date.parse(first?.history[0]?.attemptedAt ?? "");
      expect(gap).toBeGreaterThanOrEqual(0.9 * MINUTE_MS);
      expect(gap).toBeLessThanOrEqual(1.1 * MINUTE_MS);
      const [last] = await deliveriesOf(client, owner, endpoint.id);
      expect(last).toMatchObject({
        status: "FAILED",
        attempts: 5,
        nextAttemptAt: null,
      });
      expect(last?.history.map(({ statusCode }) => statusCode)).toEqual([
        500, 503, 404, 500, 500,
      ]);
      expect(last?.history[0]?.error).toBe("The receiver answered 500");
      expect(requestsTo("/fails")).toHaveLength(5);
      // Nothing more, however long it waits.
      clock.advance(24 * 60 * MINUTE_MS);
      await sendDue();
      expect(requestsTo("/fails")).toHaveLength(5);
    });

    it("refuses at sending time a host that now resolves to a private address", async () => {
      const client = api();
      const owner = await client.newOwner();
      const { endpoint } = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/moved",
      );
      receiver.hosts.set("hooks.test", "10.0.0.7");
      try {
        await cancelled(client, owner);
        await sendDue();
      } finally {
        receiver.hosts.set("hooks.test", "127.0.0.1");
      }

      const [delivery] = await deliveriesOf(client, owner, endpoint.id);
      expect(delivery?.history[0]?.statusCode).toBeNull();
      expect(delivery?.history[0]?.error).toMatch(/public internet/);
      expect(requestsTo("/moved")).toEqual([]);
    });

    it("follows no redirect, and gives up on a receiver that does not answer in time", async () => {
      const client = api();
      const owner = await client.newOwner();
      const { endpoint } = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/odd",
      );
      receiver.answer("/odd", 302, "HANG");

      await cancelled(client, owner);
      await sendDue();
      await retry(client, owner, endpoint.id);

      const [delivery] = await deliveriesOf(client, owner, endpoint.id);
      expect(
        delivery?.history.map(({ statusCode, error }) => [statusCode, error]),
      ).toEqual([
        [302, "The receiver answered 302"],
        [null, expect.stringMatching(/Timed out/)],
      ]);
      expect(requestsTo("/elsewhere")).toEqual([]);
    });

    it("sends each attempt once, however many workers look", async () => {
      const client = api();
      const owner = await client.newOwner();
      await endpointFor(client, owner, ["event.cancelled"], "/once");
      await endpointFor(client, owner, ["event.cancelled"], "/slow");
      // Another worker, able to send just as this one.
      const other = await createTestWorker({
        env,
        clock,
        safeHttp: receiver.clientOptions(1_000),
      });
      try {
        // At the same moment.
        await cancelled(client, owner);
        const block = await blockWrites(database.url, "webhook_deliveries");
        try {
          const both = Promise.all([
            sendDue(),
            other.get(WebhookSender).sendDue(),
          ]);
          await block.waitForWaiters(2);
          await block.release();
          await both;
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }
        expect(requestsTo("/once")).toHaveLength(1);
        expect(requestsTo("/slow")).toHaveLength(1);

        // While a send is still under way: the other finds nothing to take.
        receiver.answer("/once", "HANG");
        receiver.answer("/slow", "HANG");
        await cancelled(client, owner);
        const sending = sendDue();
        await expect
          .poll(() => requestsTo("/slow").length, { timeout: 5_000 })
          .toBe(2);
        await other.get(WebhookSender).sendDue();
        await sending;

        expect(requestsTo("/once")).toHaveLength(2);
        expect(requestsTo("/slow")).toHaveLength(2);
      } finally {
        await other.close();
      }
    });

    it("creates one delivery per subscribed, active endpoint of the workspace, once", async () => {
      const client = api();
      const owner = await client.newOwner();
      const stranger = await client.newOwner("stranger");
      const wanted = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/a",
      );
      await endpointFor(client, owner, ["event.live"], "/b");
      const paused = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/c",
      );
      await client
        .send(owner, "patch", `/webhook-endpoints/${paused.endpoint.id}`, {
          active: false,
        })
        .set("If-Match", '"1"');
      await endpointFor(client, stranger, ["event.cancelled"], "/d");

      const { messageId, created } = await cancelled(client, owner);
      const again = await fanOut().fanOut(messageId);

      expect(created).toBe(1);
      expect(again).toBe(0);
      const rows = await database.query<{ endpoint_id: string }>(
        "SELECT endpoint_id FROM webhook_deliveries WHERE event_id = $1",
        [messageId],
      );
      expect(rows.map(({ endpoint_id }) => endpoint_id)).toEqual([
        wanted.endpoint.id,
      ]);
    });

    it("holds the deliveries of a paused endpoint until it is active again", async () => {
      const client = api();
      const owner = await client.newOwner();
      const { endpoint } = await endpointFor(
        client,
        owner,
        ["event.cancelled"],
        "/paused",
      );
      await cancelled(client, owner);
      await client
        .send(owner, "patch", `/webhook-endpoints/${endpoint.id}`, {
          active: false,
        })
        .set("If-Match", '"1"');

      await sendDue();
      expect(requestsTo("/paused")).toEqual([]);

      await client
        .send(owner, "patch", `/webhook-endpoints/${endpoint.id}`, {
          active: true,
        })
        .set("If-Match", '"2"');
      await sendDue();
      expect(requestsTo("/paused")).toHaveLength(1);
    });

    it("runs fan-out and sending as the worker's webhook jobs", async () => {
      const client = api();
      const owner = await client.newOwner();
      await endpointFor(client, owner, ["event.cancelled"], "/jobs");
      const event = await openEvent(client, owner);
      await client.send(owner, "post", `/events/${event.id}/transitions`, {
        to: "CANCELLED",
      });
      const [message] = await database.query<{ id: string }>(
        `SELECT id FROM outbox_messages
       WHERE type = 'event.transitioned' AND payload->>'eventId' = $1
         AND payload->>'to' = 'CANCELLED'`,
        [event.id],
      );
      const consumer = worker.get(WebhooksConsumer);

      await consumer.process({
        name: "fan-out",
        data: { outboxMessageId: message?.id },
      });
      await consumer.process({ name: "deliver" });

      expect(requestsTo("/jobs")).toHaveLength(1);
      await expect(consumer.process({ name: "other" })).rejects.toThrow(
        /Unknown webhook job/,
      );
    });

    describe("attendee.registered", () => {
      async function registered(
        client: ApiClient,
        owner: TestSession,
        path: string,
      ) {
        const event = await openEvent(client, owner);
        const email = uniqueEmail("attendee");
        const browser = new PublicClient(app, newAddress());
        await browser.register(event.slug, registration(email));
        await browser.verify(
          tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
        );
        // Signed in again with a new link: still one webhook.
        await browser.register(event.slug, registration(email));
        const again = await browser.verify(
          tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
        );
        expect(again.response.status, again.response.text).toBe(200);
        const messages = await database.query<{
          id: string;
          attendee: string;
        }>(
          `SELECT id, payload->>'attendeeId' AS attendee FROM outbox_messages
         WHERE type = 'attendee.verified' AND payload->>'eventId' = $1`,
          [event.id],
        );
        expect(messages).toHaveLength(1);
        const [message] = messages;
        await fanOut().fanOut(message?.id ?? "");
        await sendDue();
        const [request] = requestsTo(path);
        return {
          event,
          email,
          attendeeId: message?.attendee ?? "",
          webhook: JSON.parse(request?.body ?? "{}") as Webhook,
        };
      }

      it("carries no personal data unless the workspace allows it", async () => {
        const client = api();
        const owner = await client.newOwner();
        await endpointFor(client, owner, ["attendee.registered"], "/plain");

        const { event, attendeeId, webhook } = await registered(
          client,
          owner,
          "/plain",
        );

        expect(webhook).toMatchObject({
          type: "attendee.registered",
          data: { eventId: event.id, attendeeId },
        });
        expect(webhook.data).not.toHaveProperty("email");
        expect(webhook.data).not.toHaveProperty("name");
      });

      it("carries the name and address when allowed, and never an erased attendee's", async () => {
        const client = api();
        const owner = await client.newOwner();
        await client.send(owner, "patch", "/workspace", {
          webhooksIncludePersonalData: true,
        });
        const { endpoint } = await endpointFor(
          client,
          owner,
          ["attendee.registered"],
          "/personal",
        );
        receiver.answer("/personal", 500);

        const { event, email, attendeeId, webhook } = await registered(
          client,
          owner,
          "/personal",
        );
        await client.send(
          owner,
          "post",
          `/events/${event.id}/attendees/${attendeeId}/erase`,
        );
        await retry(client, owner, endpoint.id);

        // Refused once: the first try had them...
        expect(webhook.data).toMatchObject({ email, name: "Ada Lovelace" });
        // ...the retry, after the erasure, does not.
        const retried = JSON.parse(
          requestsTo("/personal")[1]?.body ?? "{}",
        ) as Webhook;
        expect(retried.data).toEqual({ eventId: event.id, attendeeId });
        expect(
          WebhookDelivery.parse(
            (await deliveriesOf(client, owner, endpoint.id))[0],
          ).status,
        ).toBe("SUCCEEDED");
      });
    });
  },
);
