import { randomBytes } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { EventDetail, ProblemDetails } from "@goliveboard/contracts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createEvent, memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import { TestStream } from "../testing/test-stream.js";
import { isPublicAddress } from "../net/address-policy.js";

const problemOf = (body: unknown) => ProblemDetails.parse(body);

describe("stream settings (FR-ST-1)", () => {
  let database: TestDatabase;
  let stream: TestStream;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    database = await createTestDatabase();
    stream = await TestStream.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        QUEUE_PREFIX: `test-${randomBytes(4).toString("hex")}`,
        // Rate limits are real here; each file announces its own client
        // address (as Caddy would), so other files' sign-ups do not count.
        TRUST_PROXY_HOPS: "1",
      },
      mailer,
      // The production address rule: loopback is not allowed here.
      safeHttp: stream.clientOptions({ isAllowedAddress: isPublicAddress }),
    });
  });

  // A fresh client address per test: rate limits are real in this file, and
  // the per-address sign-up limit (10 an hour) would otherwise run out.
  let address = 0;
  beforeEach(() => {
    address += 1;
    api = new ApiClient(app, `198.51.100.${String(address)}`);
  });

  afterAll(async () => {
    await app.close();
    await stream.stop();
    await database.drop();
  });

  const setStream = (session: TestSession, eventId: string, url: string) =>
    api.send(session, "put", `/events/${eventId}/stream`, { url });

  const outboxTypes = async (eventId: string) =>
    (
      await database.query<{ type: string }>(
        "SELECT type FROM outbox_messages WHERE payload->>'eventId' = $1",
        [eventId],
      )
    ).map((row) => row.type);

  it("sets the URL, audits it and asks the worker for a check", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const url = "https://public.test/live/index.m3u8";

    const response = await setStream(owner, event.id, url);

    expect(response.status).toBe(200);
    expect(EventDetail.parse(response.body)).toMatchObject({
      streamUrl: url,
      version: 2,
    });
    expect(response.headers.etag).toBe('"2"');
    expect(await outboxTypes(event.id)).toEqual(["stream.check_requested"]);
    const [entry] = await database.query<{ after: object }>(
      "SELECT after FROM audit_entries WHERE target_id = $1 AND action = 'event.stream_set'",
      [event.id],
    );
    expect(entry?.after).toEqual({ streamUrl: url });
  });

  it.each([
    [
      "a host on a private network",
      "https://private.test/index.m3u8",
      "address_not_allowed",
    ],
    [
      "the cloud metadata address",
      "https://169.254.169.254/latest",
      "address_not_allowed",
    ],
    [
      "a host that does not resolve",
      "https://nowhere.test/index.m3u8",
      "dns_failed",
    ],
  ])("refuses %s", async (_label, url, code) => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await setStream(owner, event.id, url);

    expect(response.status).toBe(400);
    expect(problemOf(response.body).errors).toEqual([
      expect.objectContaining({ path: "url", code }),
    ]);
    expect(await outboxTypes(event.id)).toEqual([]);
  });

  it("refuses a host that resolves to loopback, where the test stream listens", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await setStream(owner, event.id, stream.url());

    expect(response.status).toBe(400);
    expect(problemOf(response.body).errors).toEqual([
      expect.objectContaining({ path: "url", code: "address_not_allowed" }),
    ]);
  });

  it("refuses an http URL by schema", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await setStream(
      owner,
      event.id,
      "http://public.test/x.m3u8",
    );

    expect(response.status).toBe(400);
  });

  it("checks on request, at most 6 times a minute per event", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    await setStream(owner, event.id, "https://public.test/index.m3u8");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (await api.send(owner, "post", `/events/${event.id}/stream/checks`))
          .status,
      );
    }

    expect(statuses).toEqual([202, 202, 202, 202, 202, 202, 429]);
    expect(await outboxTypes(event.id)).toHaveLength(7);
  });

  it("does not let another workspace use up an event's check allowance", async () => {
    const owner = await api.newOwner();
    const stranger = await api.newOwner("stranger");
    const event = await createEvent(api, owner);
    await setStream(owner, event.id, "https://public.test/index.m3u8");

    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(
        (await api.send(stranger, "post", `/events/${event.id}/stream/checks`))
          .status,
      ).toBe(404);
    }

    expect(
      (await api.send(owner, "post", `/events/${event.id}/stream/checks`))
        .status,
    ).toBe(202);
  });

  it("refuses a check before a URL is set", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await api.send(
      owner,
      "post",
      `/events/${event.id}/stream/checks`,
    );

    expect(response.status).toBe(409);
    expect(problemOf(response.body).code).toBe("STREAM_NOT_SET");
  });

  it("refuses Analysts, archived events and other workspaces", async () => {
    const owner = await api.newOwner();
    const analyst = await memberOf(api, mailer, owner, "ANALYST");
    const stranger = await api.newOwner("stranger");
    const event = await createEvent(api, owner);
    const url = "https://public.test/index.m3u8";

    expect((await setStream(analyst, event.id, url)).status).toBe(403);
    expect((await setStream(stranger, event.id, url)).status).toBe(404);
    expect(
      (await api.send(stranger, "post", `/events/${event.id}/stream/checks`))
        .status,
    ).toBe(404);
    expect(
      (await api.get(stranger, `/events/${event.id}/stream/checks`)).status,
    ).toBe(404);
    expect(
      (await api.get(stranger, `/events/${event.id}/incidents`)).status,
    ).toBe(404);
    expect(
      (await api.get(analyst, `/events/${event.id}/stream/checks`)).status,
    ).toBe(200);
    expect(
      (await api.get(analyst, `/events/${event.id}/incidents`)).status,
    ).toBe(200);

    await database.query(
      "UPDATE events SET status = 'ARCHIVED' WHERE id = $1",
      [event.id],
    );
    expect((await setStream(owner, event.id, url)).status).toBe(409);
  });
});
