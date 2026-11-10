import { Module } from "@nestjs/common";

import { DatabaseHealthIndicator } from "../database/database-health.indicator.js";
import { DatabaseModule } from "../database/database.module.js";
import { ValkeyHealthIndicator } from "../valkey/valkey-health.indicator.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { HEALTH_INDICATORS, type HealthIndicator } from "./health-indicator.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [DatabaseModule, ValkeyModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: HEALTH_INDICATORS,
      inject: [DatabaseHealthIndicator, ValkeyHealthIndicator],
      useFactory: (...indicators: HealthIndicator[]) => indicators,
    },
  ],
})
export class HealthModule {}
