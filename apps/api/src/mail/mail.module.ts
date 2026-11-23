import { Module } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { createMailer, Mailer } from "./mailer.js";

@Module({
  providers: [
    {
      provide: Mailer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createMailer(config.mail),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
