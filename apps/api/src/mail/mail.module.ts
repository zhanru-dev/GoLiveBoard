import { Module } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { Mailer, SmtpMailer, UndeliverableAddressGuard } from "./mailer.js";

@Module({
  providers: [
    {
      provide: Mailer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new UndeliverableAddressGuard(new SmtpMailer(config)),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
