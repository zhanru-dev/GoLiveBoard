import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import type { Logger } from "pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { ROOT_LOGGER } from "../observability/logger.js";
import { DatabaseHealthIndicator } from "./database-health.indicator.js";
import { createDatabasePool, DATABASE_POOL } from "./database.js";
import { createPrismaClient, PRISMA } from "./prisma.js";

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDatabasePool(config),
    },
    {
      provide: PRISMA,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => createPrismaClient(pool),
    },
    DatabaseHealthIndicator,
  ],
  exports: [DATABASE_POOL, PRISMA, DatabaseHealthIndicator],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
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

  /** Prisma first, then the pool it borrows connections from. */
  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}
