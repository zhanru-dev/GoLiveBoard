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
    });
  });

  it.each(["UPPER", "with space", "a:b", ""])(
    "rejects the queue prefix %j",
    (prefix) => {
      expect(() => loadConfig({ ...REQUIRED, QUEUE_PREFIX: prefix })).toThrow(
        ConfigError,
      );
    },
  );

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
});
