import { Pool } from "pg";

import type { AppConfig } from "../config/app-config.js";

/** Injection token for the PostgreSQL connection pool. */
export const DATABASE_POOL = Symbol("DATABASE_POOL");

/** Connections per process. RDS `db.t4g.micro` allows about 80 in total. */
const POOL_MAX_CONNECTIONS = 10;
/** Waiting longer than this for a free connection means the database is in trouble. */
const CONNECT_TIMEOUT_MS = 2_000;
const IDLE_TIMEOUT_MS = 30_000;
/**
 * Client-side safety net: a query that has not answered by now is abandoned,
 * so a network failure cannot hold a connection forever.
 */
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Creates the process's connection pool. It connects lazily, on the first
 * query, so the API starts (and reports itself not ready) while the database
 * is still starting.
 */
export function createDatabasePool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.database.url,
    max: POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    // Shown in pg_stat_activity, so a database operator can tell who is connected.
    application_name: "opspilot-api",
  });
}
