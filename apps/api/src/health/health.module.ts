import { Module } from "@nestjs/common";

import { HEALTH_INDICATORS } from "./health-indicator.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    // Database and Valkey indicators are added with those services.
    { provide: HEALTH_INDICATORS, useValue: [] },
  ],
})
export class HealthModule {}
