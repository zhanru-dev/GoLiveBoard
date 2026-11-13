import type { TestProject } from "vitest/node";

import { startPostgres } from "./containers.js";
import { migrateDatabase } from "./database.js";

/**
 * Runs once before the integration tests: starts one PostgreSQL server and
 * applies the migrations to a template database. Each test file then creates
 * its own database from the template, which takes milliseconds instead of a
 * container start and a migration run per file.
 */
export default async function setup(project: TestProject) {
  const postgres = await startPostgres();
  const templateUrl = postgres.getConnectionUri();
  await migrateDatabase(templateUrl);
  project.provide("postgresTemplateUrl", templateUrl);
  return async () => {
    await postgres.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresTemplateUrl: string;
  }
}
