import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  AuditPage,
  ProblemDetails,
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookSecret,
  Workspace,
} from "@opspilot/contracts";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { isPublicAddress } from "../net/address-policy.js";
import type { SafeHttpOptions } from "../net/safe-http.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import {
  blockWrites,
  holdLock,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import type { SecretBox } from "./secret-box.js";
import { SECRET_BOX } from "./secret-box.provider.js";

let addressCounter = 0;
const newAddress = () => `198.18.6.${String((addressCounter += 1) % 250)}`;

/** hooks.test is public, internal.test private; nothing else resolves. */
const safeHttp: SafeHttpOptions = {
  resolve: (hostname) => {
    const addresses: Record<string, string> = {
      "hooks.test": "93.184.215.14",
      "internal.test": "10.0.0.7",
    };
    const address = addresses[hostname];
    return address === undefined
      ? Promise.reject(new Error(`No address for ${hostname}`))
      : Promise.resolve([{ address, family: 4 as const }]);
  },
  isAllowedAddress: isPublicAddress,
};

describe(
  "webhook endpoints and deliveries (FR-RC-2)",
  { timeout: 30_000 },
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;
    const mailer = new CapturingMailer();

    const env = () => ({
      DATABASE_URL: database.url,
      VALKEY_URL: inject("valkeyUrl"),
      TRUST_PROXY_HOPS: "1",
    });

    beforeAll(async () => {
      database = await createTestDatabase();
      app = await createTestApp({ env: env(), mailer, safeHttp });
    });

    afterAll(async () => {
      await app.close();
      await database.drop();
    });

    const api = () => new ApiClient(app, newAddress());

    async function created(
      client: ApiClient,
      owner: TestSession,
      body: object = {
        url: "https://hooks.test/in?key=abc",
        eventTypes: ["event.live", "event.ready", "event.live"],
      },
    ): Promise<WebhookEndpointCreated> {
      const response = await client.send(
        owner,
        "post",
        "/webhook-endpoints",
        body,
      );
      expect(response.status, response.text).toBe(201);
      return WebhookEndpointCreated.parse(response.body);
    }

    async function delivery(endpointId: string, status = "FAILED") {
      const [row] = await database.query<{ id: string }>(
        `INSERT INTO webhook_deliveries
         (endpoint_id, event_id, event_type, data, occurred_at, status, attempts, next_attempt_at)
       VALUES ($1, $2, 'event.live', '{}', now(), $3::webhook_delivery_status, $4, $5)
       RETURNING id`,
        [
          endpointId,
          randomUUID(),
          status,
          status === "PENDING" ? 1 : 5,
          status === "PENDING" ? new Date() : null,
        ],
      );
      await database.query(
        `INSERT INTO webhook_attempts (delivery_id, attempted_at, status_code, duration_ms, error)
       VALUES ($1, now() - interval '1 minute', 500, 120, 'The receiver answered 500')`,
        [row?.id],
      );
      return row?.id ?? "";
    }

    describe("endpoints", () => {
      it("creates one with a secret shown once and stored only sealed", async () => {
        const client = api();
        const owner = await client.newOwner();

        const { endpoint, secret } = await created(client, owner);

        expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
        expect(endpoint).toMatchObject({
          url: "https://hooks.test/in?key=abc",
          eventTypes: ["event.live", "event.ready"],
          active: true,
          version: 1,
        });
        const listed = z
          .array(WebhookEndpoint)
          .parse((await client.get(owner, "/webhook-endpoints")).body);
        expect(listed).toEqual([endpoint]);
        expect(JSON.stringify(listed)).not.toContain(secret);
        const [row] = await database.query<{
          secret_ciphertext: Buffer;
          secret_key_id: string;
        }>(
          "SELECT secret_ciphertext, secret_key_id FROM webhook_endpoints WHERE id = $1",
          [endpoint.id],
        );
        expect(row?.secret_ciphertext.toString("latin1")).not.toContain(secret);
        const box = app.get<SecretBox>(SECRET_BOX);
        expect(
          box.open({
            ciphertext: row?.secret_ciphertext ?? Buffer.alloc(0),
            keyId: row?.secret_key_id ?? "",
          }),
        ).toBe(secret);
      });

      it("refuses a target that is not https or not public", async () => {
        const client = api();
        const owner = await client.newOwner();
        const post = (url: string) =>
          client.send(owner, "post", "/webhook-endpoints", {
            url,
            eventTypes: ["event.live"],
          });

        for (const url of [
          "http://hooks.test/in",
          "https://user:pass@hooks.test/in",
          "https://internal.test/in",
          "https://unknown.test/in",
        ]) {
          const response = await post(url);
          expect(response.status, url).toBe(400);
          expect(ProblemDetails.parse(response.body).code).toBe(
            "VALIDATION_FAILED",
          );
        }
        expect(
          (
            await post("https://hooks.test/in").send({
              url: "https://hooks.test/in",
              eventTypes: [],
            })
          ).status,
        ).toBe(400);
      });

      it("changes one from its version, refusing a stale one with 412", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const patch = (version: number, body: object) =>
          client
            .send(owner, "patch", `/webhook-endpoints/${endpoint.id}`, body)
            .set("If-Match", `"${String(version)}"`);

        const changed = await patch(1, {
          active: false,
          description: "Paused",
        });
        const stale = await patch(1, { active: true });

        expect(WebhookEndpoint.parse(changed.body)).toMatchObject({
          active: false,
          description: "Paused",
          version: 2,
        });
        expect(changed.headers.etag).toBe('"2"');
        expect(stale.status).toBe(412);
        expect(
          (await patch(2, { url: "https://internal.test/in" })).status,
        ).toBe(400);
      });

      it("lets one of two edits from the same version through", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const block = await blockWrites(database.url, "webhook_endpoints");
        let statuses: number[];
        try {
          const editing = Promise.all(
            ["First", "Second"].map((description) =>
              Promise.resolve(
                client
                  .send(owner, "patch", `/webhook-endpoints/${endpoint.id}`, {
                    description,
                  })
                  .set("If-Match", '"1"'),
              ),
            ),
          );
          await block.waitForWaiters(2);
          await block.release();
          statuses = (await editing).map(({ status }) => status);
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }

        expect(statuses.sort()).toEqual([200, 412]);
      });

      it("answers 404, not an error, to a rotation that waited for a delete", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const block = await holdLock(
          database.url,
          "SELECT id FROM webhook_endpoints WHERE id = $1 FOR UPDATE",
          [endpoint.id],
        );
        let statuses: number[];
        try {
          // The delete queues first, then the rotation.
          const deleting = Promise.resolve(
            client.send(owner, "delete", `/webhook-endpoints/${endpoint.id}`),
          );
          await block.waitForWaiters(1);
          const rotating = Promise.resolve(
            client.send(
              owner,
              "post",
              `/webhook-endpoints/${endpoint.id}/rotate-secret`,
            ),
          );
          await block.waitForWaiters(2);
          await block.release();
          statuses = [(await deleting).status, (await rotating).status];
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }

        expect(statuses).toEqual([204, 404]);
      });

      it("rotates the secret, returning the new one once", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint, secret } = await created(client, owner);

        const rotated = WebhookSecret.parse(
          (
            await client.send(
              owner,
              "post",
              `/webhook-endpoints/${endpoint.id}/rotate-secret`,
            )
          ).body,
        );

        expect(rotated.secret).not.toBe(secret);
        const [row] = await database.query<{
          secret_ciphertext: Buffer;
          secret_key_id: string;
        }>(
          "SELECT secret_ciphertext, secret_key_id FROM webhook_endpoints WHERE id = $1",
          [endpoint.id],
        );
        expect(
          app.get<SecretBox>(SECRET_BOX).open({
            ciphertext: row?.secret_ciphertext ?? Buffer.alloc(0),
            keyId: row?.secret_key_id ?? "",
          }),
        ).toBe(rotated.secret);
      });

      it("deletes one with its deliveries", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        await delivery(endpoint.id);

        const response = await client.send(
          owner,
          "delete",
          `/webhook-endpoints/${endpoint.id}`,
        );

        expect(response.status).toBe(204);
        const left = await database.query(
          "SELECT 1 FROM webhook_deliveries WHERE endpoint_id = $1",
          [endpoint.id],
        );
        expect(left).toEqual([]);
      });

      it("audits every change without the secret or the URL's query", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint, secret } = await created(client, owner);
        const rotated = WebhookSecret.parse(
          (
            await client.send(
              owner,
              "post",
              `/webhook-endpoints/${endpoint.id}/rotate-secret`,
            )
          ).body,
        );
        await client
          .send(owner, "patch", `/webhook-endpoints/${endpoint.id}`, {
            active: false,
          })
          .set("If-Match", '"1"');
        await client.send(owner, "delete", `/webhook-endpoints/${endpoint.id}`);

        const trail = AuditPage.parse(
          (await client.get(owner, "/audit-entries")).body,
        ).items;

        expect(trail.map(({ action }) => action)).toEqual([
          "webhook_endpoint.deleted",
          "webhook_endpoint.updated",
          "webhook_endpoint.secret_rotated",
          "webhook_endpoint.created",
        ]);
        const text = JSON.stringify(trail);
        expect(text).toContain("https://hooks.test/in?…");
        expect(text).not.toContain("key=abc");
        expect(text).not.toContain(secret);
        expect(text).not.toContain(rotated.secret);
      });
    });

    describe("deliveries", () => {
      it("lists an endpoint's deliveries with every attempt", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const id = await delivery(endpoint.id);

        const page = WebhookDeliveryPage.parse(
          (
            await client.get(
              owner,
              `/webhook-deliveries?endpointId=${endpoint.id}&status=FAILED`,
            )
          ).body,
        );

        expect(page.items).toEqual([
          expect.objectContaining({
            id,
            status: "FAILED",
            attempts: 5,
            nextAttemptAt: null,
            history: [
              expect.objectContaining({
                statusCode: 500,
                durationMs: 120,
                error: "The receiver answered 500",
              }),
            ],
          }),
        ]);
      });

      it("resends a finished delivery as a new round, and refuses one still being tried", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const finished = await delivery(endpoint.id);
        const pending = await delivery(endpoint.id, "PENDING");

        const resent = await client.send(
          owner,
          "post",
          `/webhook-deliveries/${finished}/redeliver`,
        );
        const refused = await client.send(
          owner,
          "post",
          `/webhook-deliveries/${pending}/redeliver`,
        );

        expect(WebhookDelivery.parse(resent.body)).toMatchObject({
          status: "PENDING",
          attempts: 0,
        });
        expect(ProblemDetails.parse(refused.body).code).toBe(
          "DELIVERY_PENDING",
        );
      });

      it("starts one round for two resends at the same moment", async () => {
        const client = api();
        const owner = await client.newOwner();
        const { endpoint } = await created(client, owner);
        const finished = await delivery(endpoint.id);
        const block = await blockWrites(database.url, "webhook_deliveries");
        let statuses: number[];
        try {
          const resending = Promise.all(
            [1, 2].map(() =>
              Promise.resolve(
                client.send(
                  owner,
                  "post",
                  `/webhook-deliveries/${finished}/redeliver`,
                ),
              ),
            ),
          );
          await block.waitForWaiters(2);
          await block.release();
          statuses = (await resending).map(({ status }) => status);
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }

        expect(statuses.sort()).toEqual([200, 409]);
      });
    });

    describe("who may", () => {
      it("is the Owner's alone, and each workspace's own", async () => {
        const client = api();
        const owner = await client.newOwner();
        const manager = await memberOf(client, mailer, owner, "MANAGER");
        const analyst = await memberOf(client, mailer, owner, "ANALYST");
        const stranger = await client.newOwner("stranger");
        const { endpoint } = await created(client, owner);
        const id = await delivery(endpoint.id);
        const requests = (session: TestSession) => [
          client.get(session, "/webhook-endpoints"),
          client.send(session, "post", "/webhook-endpoints", {
            url: "https://hooks.test/x",
            eventTypes: ["event.live"],
          }),
          client
            .send(session, "patch", `/webhook-endpoints/${endpoint.id}`, {
              active: false,
            })
            .set("If-Match", '"1"'),
          client.send(
            session,
            "post",
            `/webhook-endpoints/${endpoint.id}/rotate-secret`,
          ),
          client.send(session, "delete", `/webhook-endpoints/${endpoint.id}`),
          client.get(session, "/webhook-deliveries"),
          client.send(session, "post", `/webhook-deliveries/${id}/redeliver`),
        ];

        for (const session of [manager, analyst]) {
          for (const response of await Promise.all(requests(session))) {
            expect(response.status).toBe(403);
          }
        }
        const [list, , update, rotate, remove, deliveries, redeliver] =
          await Promise.all(requests(stranger));
        expect(z.array(WebhookEndpoint).parse(list?.body)).toEqual([]);
        for (const response of [update, rotate, remove, redeliver]) {
          expect(response?.status).toBe(404);
        }
        expect(WebhookDeliveryPage.parse(deliveries?.body).items).toEqual([]);
        const [row] = await database.query<{ active: boolean }>(
          "SELECT active FROM webhook_endpoints WHERE id = $1",
          [endpoint.id],
        );
        expect(row?.active).toBe(true);
      });
    });

    describe("without an encryption key", () => {
      let keyless: NestExpressApplication;

      beforeAll(async () => {
        keyless = await createTestApp({
          env: { ...env(), WEBHOOK_ENCRYPTION_KEY: "" },
          mailer,
          safeHttp,
        });
      });

      afterAll(async () => {
        await keyless.close();
      });

      it("says webhooks are not configured, and stores nothing", async () => {
        const client = new ApiClient(keyless, newAddress());
        const owner = await client.newOwner();

        const response = await client.send(
          owner,
          "post",
          "/webhook-endpoints",
          {
            url: "https://hooks.test/in",
            eventTypes: ["event.live"],
          },
        );

        expect(response.status).toBe(503);
        expect(ProblemDetails.parse(response.body).detail).toContain(
          "WEBHOOK_ENCRYPTION_KEY",
        );
        expect(
          z
            .array(WebhookEndpoint)
            .parse((await client.get(owner, "/webhook-endpoints")).body),
        ).toEqual([]);
      });
    });

    describe("the workspace's personal-data switch", () => {
      it("audits each of two changes made at the same moment, from the value the other left", async () => {
        const client = api();
        const owner = await client.newOwner();
        const workspaceId = (await client.me(owner)).activeWorkspace
          .workspaceId;
        const block = await holdLock(
          database.url,
          "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
          [workspaceId],
        );
        let statuses: number[];
        try {
          const on = Promise.resolve(
            client.send(owner, "patch", "/workspace", {
              webhooksIncludePersonalData: true,
            }),
          );
          await block.waitForWaiters(1);
          const off = Promise.resolve(
            client.send(owner, "patch", "/workspace", {
              webhooksIncludePersonalData: false,
            }),
          );
          await block.waitForWaiters(2);
          await block.release();
          statuses = [(await on).status, (await off).status];
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }

        expect(statuses).toEqual([200, 200]);
        const entries = AuditPage.parse(
          (await client.get(owner, "/audit-entries?action=workspace.updated"))
            .body,
        ).items;
        // Newest first.
        expect(entries.map(({ before, after }) => [before, after])).toEqual([
          [
            { webhooksIncludePersonalData: true },
            { webhooksIncludePersonalData: false },
          ],
          [
            { webhooksIncludePersonalData: false },
            { webhooksIncludePersonalData: true },
          ],
        ]);
      });

      it("is the Owner's, off by default, and audited", async () => {
        const client = api();
        const owner = await client.newOwner();
        const manager = await memberOf(client, mailer, owner, "MANAGER");

        const before = Workspace.parse(
          (await client.get(owner, "/workspace")).body,
        );
        const changed = await client.send(owner, "patch", "/workspace", {
          webhooksIncludePersonalData: true,
        });
        const refused = await client.send(manager, "patch", "/workspace", {
          webhooksIncludePersonalData: false,
        });

        expect(before.webhooksIncludePersonalData).toBe(false);
        expect(Workspace.parse(changed.body).webhooksIncludePersonalData).toBe(
          true,
        );
        expect(refused.status).toBe(403);
        const [entry] = AuditPage.parse(
          (await client.get(owner, "/audit-entries?action=workspace.updated"))
            .body,
        ).items;
        expect(entry).toMatchObject({
          before: { webhooksIncludePersonalData: false },
          after: { webhooksIncludePersonalData: true },
        });
      });
    });
  },
);
