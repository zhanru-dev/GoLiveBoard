import type { NestExpressApplication } from "@nestjs/platform-express";
import { HealthReport } from "@goliveboard/contracts";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedValkeyContainer } from "@testcontainers/valkey";
import { Redis } from "ioredis";
import { Client } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  pauseContainer,
  startPostgres,
  startValkey,
} from "../testing/containers.js";
import { createTestApp, LogCapture } from "../testing/test-app.js";

/**
 * Readiness against real PostgreSQL and Valkey servers, including what happens
 * when one of them hangs or goes away.
 */
describe("readiness with real dependencies", () => {
  let postgres: StartedPostgreSqlContainer;
  let valkey: StartedValkeyContainer;
  let app: NestExpressApplication;
  const logs = new LogCapture();

  beforeAll(async () => {
    [postgres, valkey] = await Promise.all([startPostgres(), startValkey()]);
    app = await createTestApp({
      env: {
        DATABASE_URL: postgres.getConnectionUri(),
        VALKEY_URL: valkey.getConnectionUrl(),
      },
      logs,
    });
    // Returned, not in afterAll: only what started is stopped.
    return async () => {
      await app.close();
      // The tests stop the containers themselves; this covers a test that
      // failed before doing so. Stopping twice is harmless, so errors are
      // ignored.
      await Promise.allSettled([postgres.stop(), valkey.stop()]);
    };
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

  it("logs a failed idle database connection without a request attached", async () => {
    await ready(); // leaves an idle pooled connection, opened during a request
    const admin = new Client({ connectionString: postgres.getConnectionUri() });
    await admin.connect();
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'goliveboard-api'",
    );
    await admin.end();

    const entry = await vi.waitFor(() => {
      const found = logs
        .entries()
        .find((line) => line.msg === "Idle database connection failed");
      expect(found).toBeDefined();
      return found;
    });
    expect(entry).toMatchObject({ context: "DatabaseModule" });
    expect(entry).not.toHaveProperty("req");
    expect((await ready()).status).toBe(200);
  });

  // Three checks that each wait for the 2-second health check timeout.
  const FROZEN_TEST_TIMEOUT_MS = 20_000;

  it(
    "leaves nothing behind while Valkey is frozen, and recovers at once",
    { timeout: FROZEN_TEST_TIMEOUT_MS },
    async () => {
      const resume = await pauseContainer(valkey.getId());
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const startedAt = performance.now();
          const response = await ready();
          expect(response.status).toBe(503);
          expect(performance.now() - startedAt).toBeLessThan(3_000);
        }
      } finally {
        await resume();
      }

      expect((await ready()).status).toBe(200);
      // Every timed-out check closed its connection, so once Valkey has caught
      // up no health-check connection remains open.
      const observer = new Redis(valkey.getConnectionUrl());
      try {
        await vi.waitFor(async () => {
          const clients = String(await observer.call("CLIENT", "LIST"));
          expect(clients).not.toContain("name=goliveboard-api-health");
        });
      } finally {
        observer.disconnect();
      }
    },
  );

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
