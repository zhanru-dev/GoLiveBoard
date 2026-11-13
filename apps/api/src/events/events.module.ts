import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { Idempotency } from "../idempotency/idempotency.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [EventsController],
  providers: [EventsService, Idempotency],
  exports: [EventsService],
})
export class EventsModule {}
