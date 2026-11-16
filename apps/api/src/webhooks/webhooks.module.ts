import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { secretBoxProvider } from "./secret-box.provider.js";
import { WebhookDeliveriesService } from "./webhook-deliveries.service.js";
import { WebhookEndpointsService } from "./webhook-endpoints.service.js";
import { WebhooksController } from "./webhooks.controller.js";

/** Webhooks (FR-RC-2): endpoints, deliveries and resends. */
@Module({
  imports: [DatabaseModule],
  controllers: [WebhooksController],
  providers: [
    secretBoxProvider,
    WebhookEndpointsService,
    WebhookDeliveriesService,
  ],
  exports: [secretBoxProvider],
})
export class WebhooksModule {}
