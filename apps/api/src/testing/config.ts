import { randomBytes, randomUUID } from "node:crypto";

import { type AppConfig, loadConfig } from "../config/app-config.js";

/** The app origin in tests; state-changing requests must send it. */
export const TEST_ORIGIN = "http://localhost:3300";

/**
 * Environment for tests. Nothing listens on port 1: clients connect lazily,
 * so tests that never touch the database, Valkey or SMTP need none of them.
 */
export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
  VALKEY_URL: "redis://127.0.0.1:1",
  APP_ORIGIN: TEST_ORIGIN,
  JWT_SECRET: "test-signing-key-that-is-long-enough",
  SMTP_URL: "smtp://127.0.0.1:1",
  MAIL_FROM: "OpsPilot <no-reply@opspilot.test>",
  // One per test file (each file loads this module afresh): the apps of a
  // file share real-time traffic, files running side by side do not.
  REALTIME_CHANNEL_PREFIX: `test-${randomUUID().slice(0, 8)}`,
  // Generated per run: no key-looking literal in the repository.
  WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

export function loadTestConfig(
  overrides: Readonly<Record<string, string>> = {},
): AppConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
