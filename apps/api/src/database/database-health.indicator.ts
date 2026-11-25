import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { HealthIndicator } from "../health/health-indicator.js";
import { DATABASE_POOL } from "./database.js";

@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator {
  readonly name = "database";

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** A round trip through a pooled connection proves the database answers. */
  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
