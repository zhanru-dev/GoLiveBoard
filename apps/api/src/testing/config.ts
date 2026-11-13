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
};

export function loadTestConfig(
  overrides: Readonly<Record<string, string>> = {},
): AppConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
