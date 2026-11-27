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
  AttendeePollsController,
  PollsController,
} from "./polls.controller.js";
import { PollsService } from "./polls.service.js";
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

/** Live interaction (FR-RN-1 to FR-RN-5, FR-RN-8): the real-time gateway, chat, Q&A and polls. */
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
    PollsController,
    AttendeePollsController,
    WatchController,
  ],
  providers: [
    Participants,
    RealtimeGateway,
    Fanout,
    ChatService,
    QuestionsService,
    PollsService,
    Idempotency,
    WatchService,
    ConnectionSlots,
  ],
  exports: [RealtimeGateway, QuestionsService],
})
export class LiveModule {}
