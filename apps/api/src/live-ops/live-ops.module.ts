import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { LiveOpsController } from "./live-ops.controller.js";
import { LiveOpsService } from "./live-ops.service.js";
import { LiveOpsStreams, LiveOpsTiming } from "./live-ops-streams.js";

/** The operations room: a snapshot and server-sent events (FR-RN-7). */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [LiveOpsController],
  providers: [LiveOpsService, LiveOpsStreams, LiveOpsTiming],
})
export class LiveOpsModule {}
