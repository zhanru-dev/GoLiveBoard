import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { EventsModule } from "../events/events.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { StreamsController } from "./streams.controller.js";
import { StreamsService } from "./streams.service.js";

/** The API side of streams; checking them happens in the worker. */
@Module({
  imports: [DatabaseModule, EventsModule, RateLimitModule],
  controllers: [StreamsController],
  providers: [StreamsService],
})
export class StreamsModule {}
