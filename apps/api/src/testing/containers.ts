import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  type StartedValkeyContainer,
  ValkeyContainer,
} from "@testcontainers/valkey";

/**
 * The images integration tests run against. They must match
 * docker-compose.yml (a unit test checks this), so tests and local development
 * use the same versions.
 */
export const POSTGRES_IMAGE = "postgres:18.6-alpine";
export const VALKEY_IMAGE = "valkey/valkey:9.1.3-alpine";

/** Starts a throwaway PostgreSQL server for one test file. */
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE).start();
}

/** Starts a throwaway Valkey server for one test file. */
export function startValkey(): Promise<StartedValkeyContainer> {
  return new ValkeyContainer(VALKEY_IMAGE).start();
}
