import type { NestExpressApplication } from "@nestjs/platform-express";
import { HealthReport, LivenessReport } from "@opspilot/contracts";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../testing/test-app.js";
import type { HealthIndicator } from "./health-indicator.js";

describe("health endpoints", () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function get(path: string, indicators?: readonly HealthIndicator[]) {
    app = await createTestApp({ healthIndicators: indicators });
    return request(app.getHttpServer()).get(path);
  }

  it("reports the process as live", async () => {
    const response = await get("/api/v1/health/live");

    expect(response.status).toBe(200);
    expect(LivenessReport.parse(response.body)).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("is ready when every dependency is up", async () => {
    const response = await get("/api/v1/health/ready", [
      { name: "database", check: () => Promise.resolve() },
    ]);

    expect(response.status).toBe(200);
    expect(HealthReport.parse(response.body)).toMatchObject({
      status: "ok",
      checks: { database: { status: "up" } },
    });
  });

  it("answers 503 while a dependency is down", async () => {
    const response = await get("/api/v1/health/ready", [
      { name: "database", check: () => Promise.resolve() },
      { name: "valkey", check: () => Promise.reject(new Error("refused")) },
    ]);

    expect(response.status).toBe(503);
    expect(HealthReport.parse(response.body)).toMatchObject({
      status: "unavailable",
      checks: { database: { status: "up" }, valkey: { status: "down" } },
    });
  });
});
