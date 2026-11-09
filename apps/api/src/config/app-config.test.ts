import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./app-config.js";

describe("loadConfig", () => {
  it("uses local development defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      environment: "development",
      api: { host: "127.0.0.1", port: 4301 },
      log: { level: "info", format: "json" },
    });
  });

  it("converts the port from a string, as environment variables always are", () => {
    expect(loadConfig({ API_PORT: "8080" }).api.port).toBe(8080);
  });

  it("ignores variables it does not use", () => {
    expect(() => loadConfig({ HOME: "/home/someone" })).not.toThrow();
  });

  it.each(["0", "65536", "http", "80.5", ""])("rejects API_PORT=%j", (port) => {
    expect(() => loadConfig({ API_PORT: port })).toThrow(/API_PORT/);
  });

  it("reports every invalid variable at once", () => {
    const load = () => loadConfig({ API_PORT: "0", LOG_LEVEL: "loud" });

    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/API_PORT[\s\S]*LOG_LEVEL/);
  });

  it("refuses human-readable logs in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", LOG_FORMAT: "pretty" }),
    ).toThrow(/LOG_FORMAT/);
  });
});
