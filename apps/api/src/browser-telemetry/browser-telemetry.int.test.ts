import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import { METRICS } from "../observability/metrics.js";
import { TEST_ORIGIN } from "../testing/config.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { CapturingMailer } from "../testing/fakes.js";
import { captureMetrics, type CapturedMetrics } from "../testing/metrics.js";
import { createTestApp } from "../testing/test-app.js";

let address = 1;
/** An address of its own per test, for the rate limit. */
const newAddress = () => `198.18.41.${String(address++)}`;

/**
 * Measurements from visitors' browsers (docs/06, section 7): Web Vitals on
 * real visits and real-time failures, recorded as metrics with route
 * templates only.
 */
describe("browser telemetry", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let captured: CapturedMetrics;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    // Before the app: instruments made earlier would record nowhere.
    captured = captureMetrics();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
      },
      mailer: new CapturingMailer(),
    });
    // Ready means Valkey answers: until then the rate limit cannot count,
    // and this rule drops what it cannot count.
    await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
  });

  afterEach(async () => {
    await app.close();
    await captured.stop();
  });

  afterAll(async () => {
    await database.drop();
  });

  const send = (
    body: unknown,
    ip = newAddress(),
    origin: string | null = TEST_ORIGIN,
  ) => {
    const call = request(app.getHttpServer())
      .post("/api/v1/browser-telemetry")
      .set("x-forwarded-for", ip)
      .send(body as object);
    return origin === null ? call : call.set("origin", origin);
  };

  const total = async (name: string, attributes: Record<string, unknown>) =>
    (await captured.points(name))
      .filter((point) =>
        Object.entries(attributes).every(
          ([key, value]) => point.attributes[key] === value,
        ),
      )
      .reduce((sum, point) => {
        const value = point.value as number | { count: number };
        return sum + (typeof value === "number" ? value : value.count);
      }, 0);

  it("records Web Vitals and real-time failures, by route template", async () => {
    const response = await send({
      measurements: [
        { kind: "web-vital", name: "LCP", value: 812, route: "/e/:slug" },
        { kind: "web-vital", name: "INP", value: 64, route: "/e/:slug" },
        { kind: "web-vital", name: "CLS", value: 0.02, route: "/e/:slug" },
        {
          kind: "realtime-failure",
          reason: "connect-failed",
          route: "/e/:slug/watch",
        },
      ],
    });

    expect(response.status).toBe(204);
    expect(
      await total(METRICS.webVitalDuration, {
        "goliveboard.web.vital": "LCP",
        "goliveboard.web.route": "/e/:slug",
      }),
    ).toBe(1);
    expect(
      await total(METRICS.webVitalDuration, { "goliveboard.web.vital": "INP" }),
    ).toBe(1);
    expect(
      await total(METRICS.webLayoutShift, { "goliveboard.web.vital": "CLS" }),
    ).toBe(1);
    expect(
      await total(METRICS.webRealtimeFailures, {
        "goliveboard.web.realtime_failure": "connect-failed",
        "goliveboard.web.route": "/e/:slug/watch",
      }),
    ).toBe(1);
  });

  it("refuses a real path, an unknown metric, and a request from another site", async () => {
    const realPath = await send({
      measurements: [
        {
          kind: "web-vital",
          name: "LCP",
          value: 800,
          route: "/e/product-launch-k3x9q2mz7a",
        },
      ],
    });
    const unknown = await send({
      measurements: [{ kind: "web-vital", name: "FID", value: 10, route: "/" }],
    });
    const elsewhere = await send(
      {
        measurements: [
          { kind: "web-vital", name: "LCP", value: 800, route: "/" },
        ],
      },
      newAddress(),
      "https://elsewhere.example",
    );

    expect(realPath.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(elsewhere.status).toBe(403);
    expect(await total(METRICS.webVitalDuration, {})).toBe(0);
  });

  it("counts one sender once per metric, however much it sends, so it cannot move the alerts", async () => {
    // The review's forgery: no session, the right Origin, ten slow paints
    // and ten lost connections a request.
    const ip = newAddress();
    const forged = {
      measurements: [
        ...Array.from({ length: 5 }, () => ({
          kind: "web-vital",
          name: "LCP",
          value: 10_000,
          route: "/e/:slug",
        })),
        ...Array.from({ length: 5 }, () => ({
          kind: "realtime-failure",
          reason: "lost",
          route: "/e/:slug/watch",
        })),
      ],
    };
    for (let sent = 0; sent < 4; sent++) {
      expect((await send(forged, ip)).status).toBe(204);
    }

    expect(
      await total(METRICS.webVitalDuration, {
        "goliveboard.web.vital": "LCP",
        "goliveboard.web.route": "/e/:slug",
      }),
    ).toBe(1);
    expect(
      await total(METRICS.webRealtimeFailures, {
        "goliveboard.web.realtime_failure": "lost",
      }),
    ).toBe(1);
  });

  it("takes an IPv6 /64 as one sender", async () => {
    const lost = (route: string) => ({
      measurements: [{ kind: "realtime-failure", reason: "lost", route }],
    });

    await send(lost("/"), "2001:db8:41:7::1").expect(204);
    await send(lost("/e/:slug"), "2001:db8:41:7:ffff:1:2:3").expect(204);
    await send(lost("/"), "2001:db8:41:8::1").expect(204);

    expect(
      await total(METRICS.webRealtimeFailures, {
        "goliveboard.web.realtime_failure": "lost",
      }),
    ).toBe(2);
  });

  it("drops everything one address sends beyond 120 requests in ten minutes, still answering 204", async () => {
    const ip = newAddress();
    const lost = {
      measurements: [{ kind: "realtime-failure", reason: "lost", route: "/" }],
    };
    for (let sent = 0; sent < 120; sent++) {
      expect((await send(lost, ip)).status).toBe(204);
    }

    // A measurement this sender has not sent yet, so only the request
    // limit can drop it.
    const beyond = await send(
      {
        measurements: [
          { kind: "realtime-failure", reason: "connect-failed", route: "/" },
        ],
      },
      ip,
    );

    expect(beyond.status).toBe(204);
    expect(
      await total(METRICS.webRealtimeFailures, {
        "goliveboard.web.realtime_failure": "connect-failed",
      }),
    ).toBe(0);
  });
});
