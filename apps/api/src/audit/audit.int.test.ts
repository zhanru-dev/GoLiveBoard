import { randomBytes } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuditPage, ProblemDetails } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createEvent, memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { isPublicAddress } from "../net/address-policy.js";
import { createTestApp } from "../testing/test-app.js";

let addressCounter = 0;
const newAddress = () => `198.18.5.${String((addressCounter += 1) % 250)}`;

describe("the audit trail's search (FR-RC-1)", { timeout: 30_000 }, () => {
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
      // A public address for the stream URL's host, without real DNS.
      safeHttp: {
        resolve: (hostname) =>
          hostname === "public.test"
            ? Promise.resolve([{ address: "93.184.215.14", family: 4 }])
            : Promise.reject(new Error(`No address for ${hostname}`)),
        isAllowedAddress: isPublicAddress,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const api = () => new ApiClient(app, newAddress());

  async function search(
    client: ApiClient,
    session: TestSession,
    query = "",
  ): Promise<AuditPage> {
    const response = await client.get(session, `/audit-entries${query}`);
    expect(response.status, response.text).toBe(200);
    return AuditPage.parse(response.body);
  }

  it("lists the workspace's actions newest first, with who did them", async () => {
    const client = api();
    const owner = await client.newOwner();
    const event = await createEvent(client, owner);
    await client.send(owner, "post", `/events/${event.id}/transitions`, {
      to: "CONFIGURING",
    });

    const page = await search(client, owner);

    expect(page.items.map(({ action }) => action)).toEqual([
      "event.transitioned",
      "event.created",
    ]);
    expect(page.items[0]).toMatchObject({
      actor: { kind: "USER", name: "Ada Lovelace" },
      targetType: "event",
      targetId: event.id,
      eventId: event.id,
      before: { status: "DRAFT" },
      after: { status: "CONFIGURING" },
    });
    expect(page.items[0]?.requestId).toEqual(expect.any(String));
  });

  it("filters by event, actor, action and time, and pages by cursor", async () => {
    const client = api();
    const owner = await client.newOwner();
    const manager = await memberOf(client, mailer, owner, "MANAGER");
    const first = await createEvent(client, owner);
    const second = await createEvent(client, manager);
    const managerId = (await client.me(manager)).user.id;
    const [middle] = await database.query<{ created_at: Date }>(
      "SELECT created_at FROM audit_entries WHERE target_id = $1",
      [second.id],
    );

    expect(
      (await search(client, owner, `?eventId=${first.id}`)).items.map(
        ({ targetId }) => targetId,
      ),
    ).toEqual([first.id]);
    expect(
      (await search(client, owner, `?actorId=${managerId}`)).items.map(
        ({ targetId }) => targetId,
      ),
    ).toEqual([second.id]);
    expect(
      (await search(client, owner, "?action=event.created")).items,
    ).toHaveLength(2);
    const from = encodeURIComponent(middle?.created_at.toISOString() ?? "");
    expect(
      (await search(client, owner, `?from=${from}`)).items.map(
        ({ targetId }) => targetId,
      ),
    ).toEqual([second.id]);
    expect(
      (await search(client, owner, `?to=${from}`)).items.map(
        ({ targetId }) => targetId,
      ),
    ).toEqual([first.id]);

    const firstPage = await search(client, owner, "?limit=1");
    const secondPage = await search(
      client,
      owner,
      `?limit=1&cursor=${firstPage.nextCursor ?? ""}`,
    );
    expect(firstPage.items.map(({ targetId }) => targetId)).toEqual([
      second.id,
    ]);
    expect(secondPage.items.map(({ targetId }) => targetId)).toEqual([
      first.id,
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("shows each workspace its own entries only, to every role", async () => {
    const client = api();
    const owner = await client.newOwner();
    const analyst = await memberOf(client, mailer, owner, "ANALYST");
    const stranger = await client.newOwner("stranger");
    const event = await createEvent(client, owner);
    await createEvent(client, stranger);

    expect(
      (await search(client, analyst)).items.map(({ targetId }) => targetId),
    ).toEqual([event.id]);
    // Another workspace's event: nothing, not an error that would confirm it.
    expect(
      (await search(client, stranger, `?eventId=${event.id}`)).items,
    ).toEqual([]);
    expect(
      (
        await new ApiClient(app, newAddress()).get(
          { email: "", access: "", refresh: "" },
          "/audit-entries",
        )
      ).status,
    ).toBe(401);
  });

  it("refuses a malformed cursor or a time range that ends before it starts", async () => {
    const client = api();
    const owner = await client.newOwner();

    const cursor = await client.get(owner, "/audit-entries?cursor=nonsense");
    const range = await client.get(
      owner,
      "/audit-entries?from=2026-11-20T10:00:00Z&to=2026-11-20T09:00:00Z",
    );

    expect(ProblemDetails.parse(cursor.body).code).toBe("VALIDATION_FAILED");
    expect(ProblemDetails.parse(range.body).code).toBe("VALIDATION_FAILED");
  });

  it("keeps no attendee address and no secret from a URL, whatever was done", async () => {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner, { mode: "PUBLIC" });
    const token = randomBytes(12).toString("hex");
    const stream = await client.send(
      owner,
      "put",
      `/events/${event.id}/stream`,
      {
        url: `https://public.test/live/index.m3u8?token=${token}`,
      },
    );
    expect(stream.status, stream.text).toBe(200);
    const invited = uniqueEmail("invited");
    await client.send(owner, "post", `/events/${event.id}/invitations`, {
      email: invited,
    });
    const email = uniqueEmail("attendee");
    const browser = new PublicClient(app, newAddress());
    await browser.register(event.slug, registration(email));
    await browser.verify(tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""));
    const [attendee] = await database.query<{ id: string }>(
      "SELECT id FROM attendees WHERE email = $1",
      [email],
    );
    await client.send(
      owner,
      "post",
      `/events/${event.id}/attendees/${attendee?.id ?? ""}/revoke`,
    );
    await client.send(
      owner,
      "post",
      `/events/${event.id}/attendees/${attendee?.id ?? ""}/erase`,
    );

    const trail = JSON.stringify(
      (await search(client, owner, `?eventId=${event.id}&limit=100`)).items,
    );

    expect(trail).toContain("event.stream_set");
    expect(trail).toContain("https://public.test/live/index.m3u8?…");
    expect(trail).not.toContain(token);
    expect(trail).not.toContain(email);
    expect(trail).not.toContain(invited);
  });
});
