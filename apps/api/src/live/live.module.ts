import { Module } from "@nestjs/common";

import { AttendeesModule } from "../attendees/attendees.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { Participants } from "./participants.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeSignalsModule } from "./realtime-signals.js";

/** Live interaction (FR-RN-1 to FR-RN-5): the real-time gateway, chat and Q&A. */
@Module({
  imports: [
    AuthModule,
    AttendeesModule,
    DatabaseModule,
    RateLimitModule,
    RealtimeSignalsModule,
  ],
  providers: [Participants, RealtimeGateway],
  exports: [RealtimeGateway],
})
export class LiveModule {}
