import type { TestProject } from "vitest/node";

import {
  prepareTestBucket,
  s3EndpointOf,
  startPostgres,
  startSeaweedFs,
  startValkey,
} from "./containers.js";
import { migrateDatabase } from "./database.js";

/**
 * Runs once before the integration tests: starts one PostgreSQL server and
 * one Valkey, and applies the migrations to a template database. Each test file then creates
 * its own database from the template, which takes milliseconds instead of a
 * container start and a migration run per file.
 */
export default async function setup(project: TestProject) {
  const [postgres, valkey, seaweedfs] = await Promise.all([
    startPostgres(),
    startValkey(),
    startSeaweedFs(),
  ]);
  const templateUrl = postgres.getConnectionUri();
  await migrateDatabase(templateUrl);
  project.provide("postgresTemplateUrl", templateUrl);
  // One Valkey for all files; rate-limit keys contain each test's own
  // random emails, so files cannot affect each other.
  project.provide("valkeyUrl", valkey.getConnectionUrl());
  // One object store and one bucket for every file; keys are random.
  const s3Endpoint = s3EndpointOf(seaweedfs);
  await prepareTestBucket(s3Endpoint);
  project.provide("s3Endpoint", s3Endpoint);
  return async () => {
    await Promise.all([postgres.stop(), valkey.stop(), seaweedfs.stop()]);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresTemplateUrl: string;
    valkeyUrl: string;
    s3Endpoint: string;
  }
}
