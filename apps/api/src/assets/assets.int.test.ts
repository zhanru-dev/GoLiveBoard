import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  Asset,
  AssetUpload,
  HoldingSlate,
  ProblemDetails,
  Readiness,
} from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ObjectStorage } from "../storage/object-storage.js";
import { ApiClient, type TestSession } from "../testing/api-client.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createEvent, memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

const problemOf = (body: unknown) => ProblemDetails.parse(body);

/** A PNG signature followed by filler: enough for type detection. */
const png = (size = 2_048) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(size - 8, 0x42),
  ]);

describe("holding slate upload (FR-ST-3)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  let storage: ObjectStorage;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        S3_ENDPOINT: inject("s3Endpoint"),
        S3_BUCKET: TEST_S3_BUCKET,
        S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
        S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
        S3_FORCE_PATH_STYLE: "true",
        S3_CREATE_BUCKET: "true",
      },
      mailer,
    });
    api = new ApiClient(app);
    storage = app.get(ObjectStorage);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  async function startUpload(
    session: TestSession,
    eventId: string,
    body: object = { contentType: "image/png", sizeBytes: png().length },
  ) {
    const response = await api.send(
      session,
      "post",
      `/events/${eventId}/assets/holding-slate`,
      body,
    );
    expect(response.status, response.text).toBe(201);
    return AssetUpload.parse(response.body);
  }

  /** Uploads the way the browser does: straight to storage. */
  const upload = (
    target: AssetUpload,
    body: Buffer,
    headers = target.headers,
  ) => fetch(target.url, { method: target.method, headers, body });

  const complete = (session: TestSession, assetId: string) =>
    api.send(session, "post", `/assets/${assetId}/complete`);

  async function storageKeyOf(assetId: string): Promise<string> {
    const [row] = await database.query<{ storage_key: string }>(
      "SELECT storage_key FROM assets WHERE id = $1",
      [assetId],
    );
    return row?.storage_key ?? "";
  }

  it("uploads to storage, verifies the image and removes the blocker", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const target = await startUpload(owner, event.id);

    expect(target).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/png" },
    });
    expect((await upload(target, png())).status).toBe(200);
    const done = await complete(owner, target.assetId);

    expect(done.status).toBe(200);
    expect(Asset.parse(done.body)).toMatchObject({
      id: target.assetId,
      status: "READY",
      contentType: "image/png",
      sizeBytes: 2_048,
    });
    const readiness = Readiness.parse(
      (await api.get(owner, `/events/${event.id}/readiness`)).body,
    );
    expect(readiness.blockers.map((b) => b.criterion)).not.toContain(
      "HOLDING_SLATE",
    );
    const slate = HoldingSlate.parse(
      (await api.get(owner, `/events/${event.id}/assets/holding-slate`)).body,
    );
    const download = await fetch(slate.downloadUrl);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(png());
  });

  it("lets storage refuse a file of another type or size than the one signed", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const target = await startUpload(owner, event.id);

    const otherType = await upload(target, png(), {
      "Content-Type": "text/html",
    });
    const otherSize = await upload(target, png(4_096));

    expect(otherType.status).toBe(403);
    expect(otherSize.status).toBe(403);
    expect(
      await storage.stat(await storageKeyOf(target.assetId)),
    ).toBeUndefined();
  });

  it("rejects and deletes a file that is not the declared image", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const disguised = Buffer.from(
      "<!doctype html><script>alert(1)</script>".padEnd(2_048, " "),
    );
    const target = await startUpload(owner, event.id);
    await upload(target, disguised);

    const response = await complete(owner, target.assetId);

    expect(response.status).toBe(422);
    expect(problemOf(response.body)).toMatchObject({
      code: "ASSET_REJECTED",
      detail: "The file is not the declared JPEG, PNG or WebP image.",
    });
    expect(
      await storage.stat(await storageKeyOf(target.assetId)),
    ).toBeUndefined();
    expect((await complete(owner, target.assetId)).status).toBe(422);
    expect(
      (await api.get(owner, `/events/${event.id}/assets/holding-slate`)).status,
    ).toBe(404);
  });

  it("keeps the asset pending until the file has been uploaded", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const target = await startUpload(owner, event.id);

    const early = await complete(owner, target.assetId);
    expect(early.status).toBe(409);
    expect(problemOf(early.body).code).toBe("UPLOAD_NOT_FOUND");

    await upload(target, png());
    expect((await complete(owner, target.assetId)).status).toBe(200);
  });

  it("completes once when the browser calls complete twice at the same time", async () => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);
    const target = await startUpload(owner, event.id);
    await upload(target, png());

    const responses = await Promise.all([
      Promise.resolve(complete(owner, target.assetId)),
      Promise.resolve(complete(owner, target.assetId)),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const audit = await database.query(
      "SELECT 1 FROM audit_entries WHERE target_id = $1 AND action = 'asset.ready'",
      [target.assetId],
    );
    expect(audit).toHaveLength(1);
  });

  it.each([
    ["an SVG", { contentType: "image/svg+xml", sizeBytes: 100 }],
    [
      "more than 5 MB",
      { contentType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 },
    ],
    ["an empty file", { contentType: "image/png", sizeBytes: 0 }],
  ])("refuses to start uploading %s", async (_label, body) => {
    const owner = await api.newOwner();
    const event = await createEvent(api, owner);

    const response = await api.send(
      owner,
      "post",
      `/events/${event.id}/assets/holding-slate`,
      body,
    );

    expect(response.status).toBe(400);
  });

  it("refuses Analysts, other workspaces and archived events", async () => {
    const owner = await api.newOwner();
    const analyst = await memberOf(api, mailer, owner, "ANALYST");
    const stranger = await api.newOwner("stranger");
    const event = await createEvent(api, owner);
    const body = { contentType: "image/png", sizeBytes: 2_048 };
    const target = await startUpload(owner, event.id);
    await upload(target, png());

    const start = (session: TestSession) =>
      api.send(
        session,
        "post",
        `/events/${event.id}/assets/holding-slate`,
        body,
      );
    expect((await start(analyst)).status).toBe(403);
    expect((await start(stranger)).status).toBe(404);
    expect((await complete(analyst, target.assetId)).status).toBe(403);
    expect((await complete(stranger, target.assetId)).status).toBe(404);

    await database.query(
      "UPDATE events SET status = 'ARCHIVED' WHERE id = $1",
      [event.id],
    );
    expect((await start(owner)).status).toBe(409);
    expect((await complete(owner, target.assetId)).status).toBe(409);
    expect(
      (await api.get(stranger, `/events/${event.id}/assets/holding-slate`))
        .status,
    ).toBe(404);
  });
});
