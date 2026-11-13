import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module.js";
import { MailModule } from "../mail/mail.module.js";
import { AuthController, MeController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { MeService } from "./me.service.js";
import { OriginGuard } from "./origin.guard.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    MeService,
    // Global guards run in this order: reject forged cross-site requests
    // before doing any work, then require a session unless @Public().
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AuthModule {}
