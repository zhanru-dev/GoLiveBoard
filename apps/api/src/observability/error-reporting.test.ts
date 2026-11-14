import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config/app-config.js";
import {
  type ErrorReporter,
  initErrorReporting,
  REPORT_THROTTLE_MS,
  scrubEvent,
  throttleReports,
} from "./error-reporting.js";

vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof Sentry>()),
  init: vi.fn(),
  onUnhandledRejectionIntegration: vi.fn((options: unknown) => ({
    name: "OnUnhandledRejection",
    options,
  })),
}));

const ENV = {
  DATABASE_URL: "postgres://opspilot:secret@127.0.0.1:5443/opspilot",
  VALKEY_URL: "redis://127.0.0.1:6392",
  APP_ORIGIN: "http://localhost:3300",
  JWT_SECRET: "a".repeat(32),
  SMTP_URL: "smtp://127.0.0.1:1036",
  MAIL_FROM: "OpsPilot <no-reply@opspilot.test>",
};

describe("initErrorReporting", () => {
  it("stays off without a DSN", () => {
    vi.mocked(Sentry.init).mockClear();

    expect(initErrorReporting(loadConfig(ENV), "api")).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("collects nothing personal, and exits on an unhandled rejection", () => {
    vi.mocked(Sentry.init).mockClear();
    const config = loadConfig({
      ...ENV,
      NODE_ENV: "production",
      SENTRY_DSN: "https://public@o1.ingest.sentry.io/2",
      SENTRY_RELEASE: "3f2a9c1",
    });

    expect(initErrorReporting(config, "worker")).toBe(true);

    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: "https://public@o1.ingest.sentry.io/2",
      environment: "production",
      release: "3f2a9c1",
      initialScope: { tags: { process: "worker" } },
      maxBreadcrumbs: 0,
      beforeSend: scrubEvent,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        mcp: { inputs: false, outputs: false },
      },
    });
    expect(options?.integrations).toEqual([
      { name: "OnUnhandledRejection", options: { mode: "strict" } },
    ]);
  });
});

describe("throttleReports", () => {
  function setUp() {
    let time = 1_000_000;
    const reporter = vi.fn<ErrorReporter>();
    const throttled = throttleReports(reporter, () => time);
    return {
      reporter,
      throttled,
      advance: (ms: number) => {
        time += ms;
      },
    };
  }
  const refused = () => new Error("connect ECONNREFUSED 10.0.0.5:6379");
  const context = { message: "Valkey connection failed" };

  it("reports the same error once per minute while it keeps happening", () => {
    const { reporter, throttled, advance } = setUp();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      throttled(refused(), context);
      advance(500);
    }

    // 100 attempts over 50 seconds: one report.
    expect(reporter).toHaveBeenCalledTimes(1);
    advance(REPORT_THROTTLE_MS);
    throttled(refused(), context);
    expect(reporter).toHaveBeenCalledTimes(2);
  });

  it("reports different errors independently", () => {
    const { reporter, throttled } = setUp();

    throttled(refused(), context);
    throttled(refused(), { message: "Idle database connection failed" });
    throttled(new Error("ETIMEDOUT"), context);

    expect(reporter).toHaveBeenCalledTimes(3);
  });

  it("keeps working after more kinds of error than it remembers", () => {
    const { reporter, throttled } = setUp();

    for (let index = 0; index < 1500; index += 1) {
      throttled(new Error(`failure ${String(index)}`), context);
    }

    expect(reporter).toHaveBeenCalledTimes(1500);
  });
});

describe("scrubEvent", () => {
  it("keeps only a request's method and path", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        method: "POST",
        url: "https://opspilot.example/api/v1/auth/password-reset/confirm?token=secret",
        headers: { cookie: "__Host-opspilot_access=jwt", "user-agent": "x" },
        cookies: { "__Host-opspilot_access": "jwt" },
        data: { password: "hunter2" },
        query_string: "token=secret",
      },
    };

    expect(scrubEvent(event).request).toEqual({
      method: "POST",
      url: "https://opspilot.example/api/v1/auth/password-reset/confirm",
    });
  });

  it("drops user details", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { id: "u1", email: "ada@example.com", ip_address: "203.0.113.9" },
    };

    expect(scrubEvent(event)).not.toHaveProperty("user");
  });

  it("drops the values of local variables in stack frames", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: {
              frames: [
                { function: "signIn", vars: { password: "hunter2" } },
                { function: "handle" },
              ],
            },
          },
        ],
      },
    };

    expect(
      scrubEvent(event).exception?.values?.[0]?.stacktrace?.frames,
    ).toEqual([{ function: "signIn" }, { function: "handle" }]);
  });

  it("leaves an event without a request alone", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "Outbox relay round failed",
    };

    expect(scrubEvent(event)).toEqual({
      type: undefined,
      message: "Outbox relay round failed",
    });
  });
});
