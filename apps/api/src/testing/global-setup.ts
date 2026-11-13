import type { TestProject } from "vitest/node";

import { startPostgres, startValkey } from "./containers.js";
import { migrateDatabase } from "./database.js";

/**
 * Runs once before the integration tests: starts one PostgreSQL server and
 * one Valkey, and applies the migrations to a template database. Each test file then creates
 * its own database from the template, which takes milliseconds instead of a
 * container start and a migration run per file.
 */
export default async function setup(project: TestProject) {
  const [postgres, valkey] = await Promise.all([
    startPostgres(),
    startValkey(),
  ]);
  const templateUrl = postgres.getConnectionUri();
  await migrateDatabase(templateUrl);
  project.provide("postgresTemplateUrl", templateUrl);
  // One Valkey for all files; rate-limit keys contain each test's own
  // random emails, so files cannot affect each other.
  project.provide("valkeyUrl", valkey.getConnectionUrl());
  return async () => {
    await Promise.all([postgres.stop(), valkey.stop()]);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresTemplateUrl: string;
    valkeyUrl: string;
  }
}
