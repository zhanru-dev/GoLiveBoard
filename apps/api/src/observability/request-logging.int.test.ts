import { Controller, Get } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestApp, LOG_LEVEL, LogCapture } from "../testing/test-app.js";

@Controller("test-only")
class TestOnlyController {
  constructor(
    @InjectPinoLogger("TestOnlyController")
    private readonly logger: PinoLogger,
  ) {}

  @Get("ok")
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get("crash")
  crash(): never {
    throw new Error("database exploded");
  }

  /** Logs sensitive values by mistake, as real code eventually will. */
  @Get("careless")
  careless(): { ok: true } {
    this.logger.info(
      { password: "hunter2", user: { email: "ada@example.com" } },
      "Careless log line",
    );
    return { ok: true };
  }
}

describe("request logging", () => {
  let app: NestExpressApplication;
  const logs = new LogCapture();

  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestOnlyController], logs });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Sends a request with a known ID and waits for its log lines. */
  async function logsFor(send: (id: string) => Promise<unknown>, id: string) {
    await send(id);
    return vi.waitFor(() => {
      const entries = logs.forRequest(id);
      expect(entries.length).toBeGreaterThan(0);
      return entries;
    });
  }

  it("logs one line per request with method, path and status", async () => {
    const [entry] = await logsFor(
      (id) => http().get("/api/v1/test-only/ok").set("X-Request-Id", id),
      "log-ok",
    );

    expect(entry).toMatchObject({
      level: LOG_LEVEL.info,
      msg: "request completed",
      req: { id: "log-ok", method: "GET", path: "/api/v1/test-only/ok" },
      res: { statusCode: 200 },
    });
  });

  it("never logs query strings, cookies or authorization headers", async () => {
    await logsFor(
      (id) =>
        http()
          .get("/api/v1/test-only/ok?token=one-time-secret")
          .set("Cookie", "session=cookie-secret")
          .set("Authorization", "Bearer bearer-secret")
          .set("X-Request-Id", id),
      "log-secrets",
    );

    const written = logs.lines.join("\n");
    expect(written).not.toContain("one-time-secret");
    expect(written).not.toContain("cookie-secret");
    expect(written).not.toContain("bearer-secret");
  });

  it("redacts sensitive fields that application code logs", async () => {
    const entries = await logsFor(
      (id) => http().get("/api/v1/test-only/careless").set("X-Request-Id", id),
      "log-careless",
    );

    const careless = entries.find((entry) => entry.msg === "Careless log line");
    expect(careless).toMatchObject({
      password: "[Redacted]",
      user: { email: "[Redacted]" },
    });
    expect(logs.lines.join("\n")).not.toMatch(/hunter2|ada@example\.com/);
  });

  it("logs an unexpected error with its stack, linked by request ID", async () => {
    const entries = await logsFor(
      (id) => http().get("/api/v1/test-only/crash").set("X-Request-Id", id),
      "log-crash",
    );

    const errorEntry = entries.find((entry) => entry.msg === "Unhandled error");
    expect(errorEntry?.level).toBe(LOG_LEVEL.error);
    expect(errorEntry?.err?.message).toBe("database exploded");
    expect(errorEntry?.err?.stack).toContain("crash");
  });

  it("logs requests rejected by the body parser", async () => {
    const [entry] = await logsFor(
      (id) =>
        http()
          .post("/api/v1/test-only/ok")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", id)
          .send("{not json"),
      "log-bad-json",
    );

    expect(entry?.res?.statusCode).toBe(400);
  });

  it("does not log health probes", async () => {
    await http().get("/api/v1/health/live").set("X-Request-Id", "log-health");
    await logsFor(
      (id) => http().get("/api/v1/test-only/ok").set("X-Request-Id", id),
      "log-after-health",
    );

    expect(logs.forRequest("log-health")).toEqual([]);
  });
});
