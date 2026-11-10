import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import type { Logger } from "pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { ROOT_LOGGER } from "../observability/logger.js";
import { DatabaseHealthIndicator } from "./database-health.indicator.js";
import { createDatabasePool, DATABASE_POOL } from "./database.js";

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDatabasePool(config),
    },
    DatabaseHealthIndicator,
  ],
  exports: [DATABASE_POOL, DatabaseHealthIndicator],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(ROOT_LOGGER) rootLogger: Logger,
  ) {
    const logger = rootLogger.child({ context: DatabaseModule.name });
    // An idle connection can fail at any time (for example when the database
    // restarts). Without a listener, Node treats the "error" event as fatal and
    // the whole API process would crash. The event belongs to no request, so it
    // is logged with the root logger.
    pool.on("error", (error) => {
      logger.error({ err: error }, "Idle database connection failed");
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
