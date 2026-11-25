import { Module } from "@nestjs/common";

import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { BrowserTelemetryController } from "./browser-telemetry.controller.js";
import { BrowserTelemetryService } from "./browser-telemetry.service.js";

@Module({
  imports: [RateLimitModule],
  controllers: [BrowserTelemetryController],
  providers: [BrowserTelemetryService],
})
export class BrowserTelemetryModule {}
