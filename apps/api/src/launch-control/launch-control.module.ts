import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { RealtimeSignalsModule } from "../live/realtime-signals.js";
import { EventsModule } from "../events/events.module.js";
import { AccessPolicyService } from "./access-policy.service.js";
import {
  EventLaunchControlController,
  RunbookTasksController,
} from "./launch-control.controller.js";
import { ReadinessService } from "./readiness.service.js";
import { RunbookService } from "./runbook.service.js";
import { TransitionsService } from "./transitions.service.js";

@Module({
  imports: [DatabaseModule, EventsModule, RealtimeSignalsModule],
  controllers: [EventLaunchControlController, RunbookTasksController],
  providers: [
    TransitionsService,
    ReadinessService,
    RunbookService,
    AccessPolicyService,
  ],
})
export class LaunchControlModule {}
