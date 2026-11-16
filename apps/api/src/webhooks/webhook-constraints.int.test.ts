import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../testing/database.js";

/** What the database itself guarantees about webhooks (docs/04, section 6). */
describe("webhook constraints", () => {
  let database: TestDatabase;
  let workspaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    workspaceId = randomUUID();
    await database.query(
      "INSERT INTO workspaces (id, name) VALUES ($1, 'Hooks')",
      [workspaceId],
    );
  });

  afterAll(async () => {
    await database.drop();
  });

  const endpoint = (url: string, eventTypes = "{event.live}") =>
    database.query<{ id: string }>(
      `INSERT INTO webhook_endpoints (workspace_id, url, event_types, secret_ciphertext, secret_key_id)
       VALUES ($1, $2, $3, '\\x00', 'k') RETURNING id`,
      [workspaceId, url, eventTypes],
    );

  it("takes https targets with at least one event type only", async () => {
    await expect(
      endpoint("https://hooks.example.com/in"),
    ).resolves.toHaveLength(1);
    await expect(endpoint("http://hooks.example.com/in")).rejects.toThrow(
      /webhook_endpoints_https/,
    );
    await expect(
      endpoint("https://hooks.example.com/in", "{}"),
    ).rejects.toThrow(/webhook_endpoints_event_types/);
  });

  it("keeps one delivery per event and endpoint, at most 5 attempts, and a next attempt exactly while pending", async () => {
    const [created] = await endpoint("https://hooks.example.com/d");
    const eventId = randomUUID();
    const delivery = (values: string) =>
      database.query(
        `INSERT INTO webhook_deliveries
           (endpoint_id, event_id, event_type, data, occurred_at, status, attempts, next_attempt_at)
         VALUES ($1, $2, 'event.live', '{}', now(), ${values})`,
        [created?.id, eventId],
      );

    await delivery("'PENDING', 0, now()");
    await expect(delivery("'PENDING', 0, now()")).rejects.toThrow(
      /webhook_deliveries_endpoint_id_event_id_key/,
    );
    const other = (values: string) =>
      database.query(
        `INSERT INTO webhook_deliveries
           (endpoint_id, event_id, event_type, data, occurred_at, status, attempts, next_attempt_at)
         VALUES ($1, $2, 'event.live', '{}', now(), ${values})`,
        [created?.id, randomUUID()],
      );
    await expect(other("'PENDING', 6, now()")).rejects.toThrow(
      /webhook_deliveries_attempts/,
    );
    await expect(other("'PENDING', 1, NULL")).rejects.toThrow(
      /webhook_deliveries_next_attempt/,
    );
    await expect(other("'SUCCEEDED', 1, now()")).rejects.toThrow(
      /webhook_deliveries_next_attempt/,
    );
    await expect(other("'FAILED', 5, NULL")).resolves.toBeDefined();
  });
});
