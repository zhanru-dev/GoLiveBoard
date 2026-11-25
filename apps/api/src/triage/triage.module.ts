import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { LiveModule } from "../live/live.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { TriageController } from "./triage.controller.js";
import { TriageService } from "./triage.service.js";
import { triageModelProvider } from "./triage-model.provider.js";

/** AI question triage, the API's side (FR-RN-6). */
@Module({
  imports: [DatabaseModule, LiveModule, RateLimitModule],
  controllers: [TriageController],
  providers: [TriageService, triageModelProvider],
})
export class TriageModule {}
