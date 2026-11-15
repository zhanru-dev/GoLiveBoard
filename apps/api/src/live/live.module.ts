import { Module } from "@nestjs/common";

import { AssetsModule } from "../assets/assets.module.js";
import { AttendeesModule } from "../attendees/attendees.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { Idempotency } from "../idempotency/idempotency.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { Fanout } from "./fanout.js";
import { Participants } from "./participants.js";
import {
  AttendeeQuestionsController,
  QuestionsController,
} from "./questions.controller.js";
import { QuestionsService } from "./questions.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeSignalsModule } from "./realtime-signals.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { ConnectionSlots } from "./connection-slots.js";
import { WatchController } from "./watch.controller.js";
import { WatchService } from "./watch.service.js";

/** Live interaction (FR-RN-1 to FR-RN-5): the real-time gateway, chat and Q&A. */
@Module({
  imports: [
    AssetsModule,
    AuthModule,
    AttendeesModule,
    DatabaseModule,
    RateLimitModule,
    RealtimeSignalsModule,
    ValkeyModule,
  ],
  controllers: [
    ChatController,
    QuestionsController,
    AttendeeQuestionsController,
    WatchController,
  ],
  providers: [
    Participants,
    RealtimeGateway,
    Fanout,
    ChatService,
    QuestionsService,
    Idempotency,
    WatchService,
    ConnectionSlots,
  ],
  exports: [RealtimeGateway],
})
export class LiveModule {}
