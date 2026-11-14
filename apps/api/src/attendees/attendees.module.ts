import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MailModule } from "../mail/mail.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { AttendeeMail } from "./attendee-mail.js";
import { AttendeeSelfService } from "./attendee-self.service.js";
import { AttendeeGuard } from "./attendee.guard.js";
import { AudienceController } from "./audience.controller.js";
import { AudienceService } from "./audience.service.js";
import { PublicController } from "./public.controller.js";
import { RegistrationService } from "./registration.service.js";

/** Admission (FR-AD-1 to FR-AD-6): the public side and attendee sessions. */
@Module({
  imports: [DatabaseModule, MailModule, RateLimitModule],
  controllers: [PublicController, AudienceController],
  providers: [
    AudienceService,
    RegistrationService,
    AttendeeSelfService,
    AttendeeMail,
    AttendeeGuard,
  ],
  exports: [AttendeeMail],
})
export class AttendeesModule {}
