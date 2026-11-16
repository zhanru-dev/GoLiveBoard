import { randomBytes } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { WebhookEndpointCreated } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { openEvent } from "../testing/admission.js";
import { ApiClient } from "../testing/api-client.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { TestReceiver } from "../testing/test-receiver.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { WebhooksConsumer } from "../worker/webhooks.consumer.js";
import { keyIdOf, SecretBox } from "./secret-box.js";
import { SecretResealer } from "./secret-resealer.js";
import { WebhookFanOut } from "./webhook-fan-out.js";
import { WebhookSender } from "./webhook-sender.js";

let addressCounter = 0;
const newAddress = () => `198.18.10.${String((addressCounter += 1) % 250)}`;

describe("rotating the webhook encryption key", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let receiver: TestReceiver;
  let app: NestExpressApplication;
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const workers: INestApplicationContext[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    receiver = await TestReceiver.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
        WEBHOOK_ENCRYPTION_KEY: oldKey.toString("base64"),
      },
      safeHttp: receiver.clientOptions(),
    });
  });

  afterAll(async () => {
    for (const worker of workers) {
      await worker.close();
    }
    await app.close();
    await receiver.stop();
    await database.drop();
  });

  /** A worker with these keys. */
  async function workerWith(current: Buffer, previous?: Buffer) {
    const worker = await createTestWorker({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        WEBHOOK_ENCRYPTION_KEY: current.toString("base64"),
        WEBHOOK_ENCRYPTION_KEY_PREVIOUS: previous?.toString("base64") ?? "",
      },
      safeHttp: receiver.clientOptions(1_000),
    });
    workers.push(worker);
    return worker;
  }

  async function endpoint(path: string) {
    const client = new ApiClient(app, newAddress());
    const owner = await client.newOwner();
    const response = await client.send(owner, "post", "/webhook-endpoints", {
      url: receiver.url(path),
      eventTypes: ["event.cancelled"],
    });
    expect(response.status, response.text).toBe(201);
    return { client, owner, ...WebhookEndpointCreated.parse(response.body) };
  }

  const keyIdIn = async (endpointId: string) =>
    (
      await database.query<{ secret_key_id: string }>(
        "SELECT secret_key_id FROM webhook_endpoints WHERE id = $1",
        [endpointId],
      )
    )[0]?.secret_key_id;

  it("seals the secrets again with the new key, so the old one can go, and receivers notice nothing", async () => {
    const created = await endpoint("/rotated-key");
    const rotating = await workerWith(newKey, oldKey);

    await rotating.get(WebhooksConsumer).process({ name: "reseal" });
    const again = await rotating.get(SecretResealer).resealStale();

    expect(await keyIdIn(created.endpoint.id)).toBe(keyIdOf(newKey));
    expect(again).toBe(0);

    // The old key gone: the same secret still signs.
    const after = await workerWith(newKey);
    const event = await openEvent(created.client, created.owner);
    await created.client.send(
      created.owner,
      "post",
      `/events/${event.id}/transitions`,
      { to: "CANCELLED" },
    );
    const [message] = await database.query<{ id: string }>(
      `SELECT id FROM outbox_messages
       WHERE type = 'event.transitioned' AND payload->>'eventId' = $1
         AND payload->>'to' = 'CANCELLED'`,
      [event.id],
    );
    await after.get(WebhookFanOut).fanOut(message?.id ?? "");
    await after.get(WebhookSender).sendDue();
    const now = Math.floor(Date.now() / 1000);
    expect(receiver.accepted(created.secret, now)).toEqual([
      expect.objectContaining({ id: message?.id }),
    ]);
  });

  it("leaves alone a secret rotated while it worked, and seals that one next time", async () => {
    const created = await endpoint("/raced");
    const rotating = await workerWith(newKey, oldKey);
    // Rotated by an API instance still on the old key, as during a rollout:
    // a new secret under the same key ID.
    const rotated = new SecretBox(oldKey).seal("whsec_rotated-meanwhile");
    const block = await holdLock(
      database.url,
      "SELECT id FROM webhook_endpoints WHERE id = $1 FOR UPDATE",
      [created.endpoint.id],
    );
    let first: Promise<number>;
    try {
      first = rotating.get(SecretResealer).resealStale();
      await block.waitForWaiters(1);
      await block.run(
        "UPDATE webhook_endpoints SET secret_ciphertext = $2 WHERE id = $1",
        [created.endpoint.id, rotated.ciphertext],
      );
      await block.release();
    } catch (error) {
      await block.release().catch(() => undefined);
      throw error;
    }

    expect(await first).toBe(0);
    expect(await keyIdIn(created.endpoint.id)).toBe(keyIdOf(oldKey));

    expect(await rotating.get(SecretResealer).resealStale()).toBe(1);
    const [row] = await database.query<{
      secret_ciphertext: Buffer;
      secret_key_id: string;
    }>(
      "SELECT secret_ciphertext, secret_key_id FROM webhook_endpoints WHERE id = $1",
      [created.endpoint.id],
    );
    expect(
      new SecretBox(newKey).open({
        ciphertext: row?.secret_ciphertext ?? Buffer.alloc(0),
        keyId: row?.secret_key_id ?? "",
      }),
    ).toBe("whsec_rotated-meanwhile");
  });
});
