import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { secretBoxProvider } from "./secret-box.provider.js";
import { SecretResealer } from "./secret-resealer.js";
import { WebhookFanOut } from "./webhook-fan-out.js";
import { WebhookSender } from "./webhook-sender.js";

/** The worker's side of webhooks: fan-out and sending (FR-RC-2). */
@Module({
  imports: [DatabaseModule],
  providers: [secretBoxProvider, WebhookFanOut, WebhookSender, SecretResealer],
  exports: [WebhookFanOut, WebhookSender, SecretResealer],
})
export class WebhookDeliveryModule {}
