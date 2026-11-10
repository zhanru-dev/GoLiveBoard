import type { NestExpressApplication } from "@nestjs/platform-express";
import { HealthReport } from "@opspilot/contracts";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedValkeyContainer } from "@testcontainers/valkey";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, startValkey } from "../testing/containers.js";
import { createTestApp } from "../testing/test-app.js";

/**
 * Readiness against real PostgreSQL and Valkey servers, including what happens
 * when one of them goes away.
 */
describe("readiness with real dependencies", () => {
  let postgres: StartedPostgreSqlContainer;
  let valkey: StartedValkeyContainer;
  let app: NestExpressApplication;

  beforeAll(async () => {
    [postgres, valkey] = await Promise.all([startPostgres(), startValkey()]);
    app = await createTestApp({
      env: {
        DATABASE_URL: postgres.getConnectionUri(),
        VALKEY_URL: valkey.getConnectionUrl(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    // The tests stop the containers themselves; this covers a test that
    // failed before doing so. Stopping twice is harmless, so errors are ignored.
    await Promise.allSettled([postgres.stop(), valkey.stop()]);
  });

  const ready = () => request(app.getHttpServer()).get("/api/v1/health/ready");

  it("is ready when the database and Valkey answer", async () => {
    const response = await ready();

    expect(response.status).toBe(200);
    expect(HealthReport.parse(response.body)).toMatchObject({
      status: "ok",
      checks: { database: { status: "up" }, valkey: { status: "up" } },
    });
  });

  it("answers 503 within the check timeout once Valkey stops", async () => {
    await valkey.stop();
    const startedAt = performance.now();

    const response = await ready();

    expect(response.status).toBe(503);
    expect(HealthReport.parse(response.body)).toMatchObject({
      status: "unavailable",
      checks: { database: { status: "up" }, valkey: { status: "down" } },
    });
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });

  it("reports the database down once PostgreSQL stops", async () => {
    await postgres.stop();

    const response = await ready();

    expect(response.status).toBe(503);
    expect(HealthReport.parse(response.body).checks.database?.status).toBe(
      "down",
    );
  });
});
