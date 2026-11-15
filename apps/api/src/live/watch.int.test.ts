import type { NestExpressApplication } from "@nestjs/platform-express";
import { WatchInfo } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { ACCESS_COOKIE } from "../auth/cookies.js";
import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { cookieHeader } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { prepareForLaunch } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp } from "../testing/test-app.js";

let addressCounter = 0;
const newAddress = () => `198.18.4.${String((addressCounter += 1) % 250)}`;

describe(
  "the watch page (FR-RN-1) and attendance (FR-RN-7)",
  { timeout: 30_000 },
  () => {
    let database: TestDatabase;
    let app: NestExpressApplication;
    let url: string;
    const mailer = new CapturingMailer();
    const clients: RealtimeClient[] = [];

    beforeAll(async () => {
      database = await createTestDatabase();
      app = await createTestApp({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          TRUST_PROXY_HOPS: "1",
          S3_ENDPOINT: inject("s3Endpoint"),
          S3_BUCKET: TEST_S3_BUCKET,
          S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
          S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
          S3_FORCE_PATH_STYLE: "true",
        },
        mailer,
      });
      url = await listen(app);
    });

    afterAll(async () => {
      for (const client of clients) {
        client.close();
      }
      await app.close();
      await database.drop();
    });

    async function setUp() {
      const api = new ApiClient(app, newAddress());
      const owner = await api.newOwner();
      const event = await openEvent(api, owner);
      return { api, owner, event };
    }

    async function attendee(slug: string) {
      const email = uniqueEmail("att");
      const browser = new PublicClient(app, newAddress());
      await browser.register(slug, registration(email));
      const verified = await browser.verify(
        tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
      );
      const token = verified.attendee?.cookie(ATTENDEE_COOKIE);
      if (verified.attendee === undefined || token === undefined) {
        throw new Error(`Verification failed: ${verified.response.text}`);
      }
      return {
        browser: verified.attendee,
        cookie: cookieHeader({ [ATTENDEE_COOKIE]: token }),
      };
    }

    async function goLive(api: ApiClient, owner: TestSession, eventId: string) {
      for (const to of ["READY", "LIVE"]) {
        const moved = await api.send(
          owner,
          "post",
          `/events/${eventId}/transitions`,
          {
            to,
          },
        );
        expect(moved.status, moved.text).toBe(200);
      }
    }

    async function connect(cookie: string) {
      const client = await RealtimeClient.connect(url, {
        cookie,
        ip: newAddress(),
      });
      clients.push(client);
      return client;
    }

    const minutes = (eventId: string) =>
      database.query(
        "SELECT attendee_id FROM attendance_minutes WHERE event_id = $1",
        [eventId],
      );

    describe("GET /public/events/:slug/watch", () => {
      it("shows the slate before the event is live, and the stream only once it is", async () => {
        const { api, owner, event } = await setUp();
        await prepareForLaunch(api, database, owner, event.id, new Date());
        const visitor = await attendee(event.slug);
        const watch = async () =>
          WatchInfo.parse(
            (await visitor.browser.get(`/public/events/${event.slug}/watch`))
              .body,
          );

        const before = await watch();

        expect(before).toMatchObject({
          slug: event.slug,
          title: event.title,
          status: "UPCOMING",
          streamUrl: null,
        });
        expect(before.slate?.url).toContain(`slates/${event.id}`);

        await goLive(api, owner, event.id);

        expect(await watch()).toMatchObject({
          status: "LIVE",
          streamUrl: "https://stream.example.com/index.m3u8",
        });
      });

      it("has no slate to show when none is ready", async () => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        // Uploaded but not verified, and refused: neither is shown.
        await database.query(
          `INSERT INTO assets (event_id, kind, storage_key, status, content_type, size_bytes)
           VALUES ($1, 'HOLDING_SLATE', $2, 'PENDING', 'image/png', 1024),
                  ($1, 'HOLDING_SLATE', $3, 'REJECTED', 'image/png', 1024)`,
          [event.id, `uploads/${event.id}/a`, `uploads/${event.id}/b`],
        );

        const info = WatchInfo.parse(
          (await visitor.browser.get(`/public/events/${event.slug}/watch`))
            .body,
        );

        expect(info.slate).toBeNull();
      });

      it("is for the event's admitted attendees only", async () => {
        const { event } = await setUp();
        const other = await setUp();
        const otherVisitor = await attendee(other.event.slug);

        expect(
          (
            await new PublicClient(app, newAddress()).get(
              `/public/events/${event.slug}/watch`,
            )
          ).status,
        ).toBe(401);
        expect(
          (await otherVisitor.browser.get(`/public/events/${event.slug}/watch`))
            .status,
        ).toBe(404);
      });
    });

    describe("heartbeats", () => {
      it("record one row per attendee and minute while the event is live", async () => {
        const { api, owner, event } = await setUp();
        await prepareForLaunch(api, database, owner, event.id, new Date());
        const visitor = await attendee(event.slug);
        const tabs = [
          await connect(visitor.cookie),
          await connect(visitor.cookie),
        ];

        await expect(tabs[0]?.heartbeat(event.slug)).resolves.toEqual({
          ok: false,
          error: "CLOSED",
        });
        expect(await minutes(event.id)).toEqual([]);

        await goLive(api, owner, event.id);
        for (const tab of tabs) {
          await expect(tab.heartbeat(event.slug)).resolves.toEqual({
            ok: true,
          });
          await expect(tab.heartbeat(event.slug)).resolves.toEqual({
            ok: true,
          });
        }

        expect(await minutes(event.id)).toHaveLength(1);
      });

      it("leave staff out of the audience, and refuse what is not a heartbeat", async () => {
        const { api, owner, event } = await setUp();
        await prepareForLaunch(api, database, owner, event.id, new Date());
        await goLive(api, owner, event.id);
        const staff = await connect(
          cookieHeader({ [ACCESS_COOKIE]: owner.access }),
        );

        await expect(staff.heartbeat(event.slug)).resolves.toEqual({
          ok: true,
        });
        await expect(
          staff.emit("watch.heartbeat", { slug: "" }),
        ).resolves.toEqual({
          ok: false,
          error: "INVALID",
        });
        expect(await minutes(event.id)).toEqual([]);
      });
    });
  },
);
