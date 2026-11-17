import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./app-config.js";

/** The variables without defaults; everything else is optional. */
const REQUIRED = {
  DATABASE_URL: "postgres://opspilot:secret@127.0.0.1:5443/opspilot",
  VALKEY_URL: "redis://127.0.0.1:6392",
  APP_ORIGIN: "http://localhost:3300/",
  JWT_SECRET: "a".repeat(32),
  SMTP_URL: "smtp://127.0.0.1:1036",
  MAIL_FROM: "OpsPilot <no-reply@opspilot.test>",
};

describe("loadConfig", () => {
  it("uses local development defaults for everything but connection strings and secrets", () => {
    expect(loadConfig(REQUIRED)).toEqual({
      environment: "development",
      api: { host: "127.0.0.1", port: 4301, trustProxyHops: 0 },
      realtime: { sweepMs: 30_000, channelPrefix: "opspilot" },
      webhooks: { encryptionKey: undefined, previousEncryptionKey: undefined },
      log: { level: "info", format: "json" },
      database: { url: REQUIRED.DATABASE_URL },
      valkey: { url: REQUIRED.VALKEY_URL },
      queues: { prefix: "opspilot" },
      app: { origin: "http://localhost:3300" },
      auth: { jwtSecret: "a".repeat(32), jwtPreviousSecret: undefined },
      mail: {
        smtpUrl: REQUIRED.SMTP_URL,
        from: "OpsPilot <no-reply@opspilot.test>",
      },
      demo: { enabled: false },
      triage: {
        provider: "none",
        apiKey: undefined,
        baseUrl: undefined,
        model: "claude-opus-5-5",
        dailyBudgetMicros: undefined,
      },
      errorReporting: {
        dsn: undefined,
        environment: "development",
        release: undefined,
      },
      storage: {
        endpoint: undefined,
        publicEndpoint: undefined,
        region: "eu-west-2",
        bucket: "opspilot-assets",
        credentials: undefined,
        forcePathStyle: false,
        createBucket: false,
      },
    });
  });

  it("reports errors to the configured Sentry project, tagged with the release", () => {
    const config = loadConfig({
      ...REQUIRED,
      NODE_ENV: "production",
      SENTRY_DSN: "https://public@o1.ingest.sentry.io/2",
      SENTRY_RELEASE: "3f2a9c1",
    });

    expect(config.errorReporting).toEqual({
      dsn: "https://public@o1.ingest.sentry.io/2",
      environment: "production",
      release: "3f2a9c1",
    });
  });

  it("treats empty Sentry settings, as Compose passes unset ones, as not set", () => {
    const config = loadConfig({
      ...REQUIRED,
      SENTRY_DSN: "",
      SENTRY_ENVIRONMENT: "",
      SENTRY_RELEASE: "",
    });

    expect(config.errorReporting).toEqual({
      dsn: undefined,
      environment: "development",
      release: undefined,
    });
  });

  it.each(["not a url", "ftp://public@sentry.example/1"])(
    "rejects the Sentry DSN %j",
    (dsn) => {
      expect(() => loadConfig({ ...REQUIRED, SENTRY_DSN: dsn })).toThrow(
        /SENTRY_DSN/,
      );
    },
  );

  it.each(["UPPER", "with space", "a:b", ""])(
    "rejects the queue prefix %j",
    (prefix) => {
      expect(() => loadConfig({ ...REQUIRED, QUEUE_PREFIX: prefix })).toThrow(
        ConfigError,
      );
    },
  );

  it("signs browser URLs for the public storage endpoint when one is set", () => {
    const config = loadConfig({
      ...REQUIRED,
      S3_ENDPOINT: "http://s3:8333",
      S3_PUBLIC_ENDPOINT: "http://localhost:8333",
      S3_FORCE_PATH_STYLE: "true",
    });

    expect(config.storage).toMatchObject({
      endpoint: "http://s3:8333",
      publicEndpoint: "http://localhost:8333",
      forcePathStyle: true,
    });
  });

  it("leaves AI triage off by default, and needs a key for Claude", () => {
    expect(() => loadConfig({ ...REQUIRED, AI_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(
      loadConfig({
        ...REQUIRED,
        AI_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-key",
        AI_TRIAGE_MODEL: "claude-sonnet-5-5",
      }).triage,
    ).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(() => loadConfig({ ...REQUIRED, AI_PROVIDER: "openai" })).toThrow(
      /AI_PROVIDER/,
    );
    expect(
      loadConfig({ ...REQUIRED, TRIAGE_DAILY_BUDGET_USD: "2.5" }).triage
        .dailyBudgetMicros,
    ).toBe(2_500_000);
    expect(() =>
      loadConfig({ ...REQUIRED, TRIAGE_DAILY_BUDGET_USD: "-1" }),
    ).toThrow(/TRIAGE_DAILY_BUDGET_USD/);
  });

  it("requires both storage credentials or neither", () => {
    expect(() => loadConfig({ ...REQUIRED, S3_ACCESS_KEY_ID: "key" })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
  });

  it("requires the connection strings", () => {
    const load = () => loadConfig({});

    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/DATABASE_URL[\s\S]*VALKEY_URL[\s\S]*JWT_SECRET/);
  });

  it.each([
    ["DATABASE_URL", "mysql://localhost/opspilot"],
    ["DATABASE_URL", "not a url"],
    ["VALKEY_URL", "http://127.0.0.1:6392"],
  ])("rejects %s=%j", (name, value) => {
    expect(() => loadConfig({ ...REQUIRED, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it("accepts the postgresql:// spelling and TLS Valkey", () => {
    expect(() =>
      loadConfig({
        ...REQUIRED,
        DATABASE_URL: "postgresql://user:pw@db.internal:5432/opspilot",
        VALKEY_URL: "rediss://cache.internal:6379",
      }),
    ).not.toThrow();
  });

  it("rejects a signing key shorter than 32 characters", () => {
    expect(() => loadConfig({ ...REQUIRED, JWT_SECRET: "too-short" })).toThrow(
      /JWT_SECRET/,
    );
  });

  it("converts the port from a string, as environment variables always are", () => {
    expect(loadConfig({ ...REQUIRED, API_PORT: "8080" }).api.port).toBe(8080);
  });

  it("ignores variables it does not use", () => {
    expect(() =>
      loadConfig({ ...REQUIRED, HOME: "/home/someone" }),
    ).not.toThrow();
  });

  it.each(["0", "65536", "http", "80.5", ""])("rejects API_PORT=%j", (port) => {
    expect(() => loadConfig({ ...REQUIRED, API_PORT: port })).toThrow(
      /API_PORT/,
    );
  });

  it("reports every invalid variable at once", () => {
    const load = () =>
      loadConfig({ ...REQUIRED, API_PORT: "0", LOG_LEVEL: "loud" });

    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/API_PORT[\s\S]*LOG_LEVEL/);
  });

  it("refuses human-readable logs in production", () => {
    expect(() =>
      loadConfig({ ...REQUIRED, NODE_ENV: "production", LOG_FORMAT: "pretty" }),
    ).toThrow(/LOG_FORMAT/);
  });

  it("never puts a connection string in the error message", () => {
    expect(() =>
      loadConfig({ ...REQUIRED, DATABASE_URL: "mysql://admin:hunter2@db/x" }),
    ).toThrow(/^(?![\s\S]*hunter2)/);
  });

  it("reads webhook encryption keys as 32 bytes of base64, and refuses any other size", () => {
    const key = Buffer.alloc(32, 7);

    const config = loadConfig({
      ...REQUIRED,
      WEBHOOK_ENCRYPTION_KEY: key.toString("base64"),
    });

    expect(config.webhooks.encryptionKey?.equals(key)).toBe(true);
    expect(() =>
      loadConfig({
        ...REQUIRED,
        WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);
  });
});
