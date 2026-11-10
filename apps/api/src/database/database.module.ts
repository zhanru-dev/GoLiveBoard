import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { Pool } from "pg";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
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
    @InjectPinoLogger(DatabaseModule.name) logger: PinoLogger,
  ) {
    // An idle connection can fail at any time (for example when the database
    // restarts). Without a listener, Node treats the "error" event as fatal and
    // the whole API process would crash.
    pool.on("error", (error) => {
      logger.error({ err: error }, "Idle database connection failed");
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
