import { Controller, Get } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as Sentry from "@sentry/node";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Public } from "../auth/actor.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { loadTestConfig } from "../testing/config.js";
import { type FakeSentry, startFakeSentry } from "../testing/fake-sentry.js";
import { createTestApp, LogCapture } from "../testing/test-app.js";
import { flushErrorReports, initErrorReporting } from "./error-reporting.js";

type Tags = Record<string, string> | undefined;

@Public()
@Controller("test-only")
class TestOnlyController {
  @Get("crash")
  crash(): never {
    // A local variable holding a secret, as real code will have. Built at run
    // time, so the source lines Sentry sends around the throw do not contain
    // it: only the variable's value could.
    const password = ["hunter2", "local", "variable"].join("-");
    throw new Error(`database exploded (${String(password.length)})`);
  }

  @Get("refused")
  refused(): never {
    throw new DomainError("VERSION_CONFLICT");
  }
}

describe("error reporting (Sentry)", () => {
  let sentry: FakeSentry;
  let app: NestExpressApplication;

  beforeAll(async () => {
    sentry = await startFakeSentry();
    expect(
      initErrorReporting(
        loadTestConfig({
          SENTRY_DSN: sentry.dsn,
          SENTRY_RELEASE: "test-release",
        }),
        "api",
      ),
    ).toBe(true);
    // Reporting follows logging, so the app logs (into memory).
    app = await createTestApp({
      controllers: [TestOnlyController],
      logs: new LogCapture(),
    });
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close(1000);
    await sentry.close();
  });

  // What leaves the process, end to end. Today Sentry attaches no request
  // data or local variables here even with its defaults, so this alone would
  // not notice `dataCollection` or `scrubEvent` going missing; their unit
  // tests (error-reporting.test.ts) do. It catches a change that starts
  // sending them.
  it("reports an unexpected error once, tagged with its request, and nothing personal", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test-only/crash?token=one-time-secret")
      .set("Cookie", "__Host-opspilot_access=session-secret")
      .set("Authorization", "Bearer header-secret");
    expect(response.status).toBe(500);
    const requestId = response.headers["x-request-id"];

    await flushErrorReports();
    // Other errors are reported too (the test configuration's Valkey does
    // not exist), so look at this request's.
    const forRequest = () =>
      sentry
        .events()
        .filter(({ event }) => (event.tags as Tags)?.request_id === requestId);
    await expect.poll(() => forRequest().length).toBe(1);
    const [received] = forRequest();

    expect(received?.event).toMatchObject({
      level: "error",
      release: "test-release",
      environment: "test",
      tags: { request_id: requestId, process: "api" },
      contexts: expect.objectContaining({
        log: { message: "Unhandled error" },
      }) as unknown,
      exception: {
        values: [
          expect.objectContaining({
            type: "Error",
            value: "database exploded (22)",
          }),
        ],
      },
    });
    for (const secret of [
      "one-time-secret",
      "session-secret",
      "header-secret",
      "hunter2-local-variable",
    ]) {
      expect(received?.envelope).not.toContain(secret);
    }
  });

  it("does not report errors the API answers on purpose", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/v1/test-only/refused",
    );
    expect(response.status).toBe(412);
    await flushErrorReports();

    const requestId = response.headers["x-request-id"];
    expect(
      sentry
        .events()
        .filter(({ event }) => (event.tags as Tags)?.request_id === requestId),
    ).toEqual([]);
  });
});
