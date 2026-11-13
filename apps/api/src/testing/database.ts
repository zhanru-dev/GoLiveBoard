import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { Client } from "pg";
import { inject } from "vitest";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve("prisma/build/index.js");
const API_ROOT = new URL("../..", import.meta.url).pathname;

/** Applies every migration in prisma/migrations, exactly as a deployment does. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  await run(process.execPath, [PRISMA_CLI, "migrate", "deploy"], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/**
 * Runs `prisma migrate diff` between the database and schema.prisma.
 * Resolves with the SQL that would make them match: empty when the
 * migrations produce exactly the schema.
 */
export async function diffDatabaseAgainstSchema(
  databaseUrl: string,
): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    [
      PRISMA_CLI,
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  return stdout;
}

export interface TestDatabase {
  readonly url: string;
  /** Runs one query, for tests that assert on what was stored. */
  query<Row extends object>(text: string, values?: unknown[]): Promise<Row[]>;
  drop(): Promise<void>;
}

async function withClient<T>(
  serverUrl: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * A fresh, migrated database for one test file, copied from the template the
 * global setup prepared. Test files never see each other's data.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const templateUrl = new URL(inject("postgresTemplateUrl"));
  const templateName = templateUrl.pathname.slice(1);
  const name = `test_${randomBytes(6).toString("hex")}`;
  const serverUrl = new URL(templateUrl);
  serverUrl.pathname = "/postgres";

  await withClient(serverUrl.href, (client) =>
    client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`),
  );
  const url = new URL(templateUrl);
  url.pathname = `/${name}`;
  return {
    url: url.href,
    query: <Row extends object>(text: string, values?: unknown[]) =>
      withClient(url.href, async (client) => {
        const result = await client.query<Row>(text, values);
        return result.rows;
      }),
    drop: () =>
      withClient(serverUrl.href, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }),
  };
}
