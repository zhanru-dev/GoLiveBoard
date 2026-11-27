import { Module } from "@nestjs/common";

import { DatabaseHealthIndicator } from "../database/database-health.indicator.js";
import { DatabaseModule } from "../database/database.module.js";
import { AwsCredentialsHealthIndicator } from "../storage/aws-credentials-health.indicator.js";
import { StorageModule } from "../storage/storage.module.js";
import { ValkeyHealthIndicator } from "../valkey/valkey-health.indicator.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { HEALTH_INDICATORS, type HealthIndicator } from "./health-indicator.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [DatabaseModule, ValkeyModule, StorageModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: HEALTH_INDICATORS,
      inject: [
        DatabaseHealthIndicator,
        ValkeyHealthIndicator,
        AwsCredentialsHealthIndicator,
      ],
      useFactory: (...indicators: HealthIndicator[]) => indicators,
    },
  ],
})
export class HealthModule {}
