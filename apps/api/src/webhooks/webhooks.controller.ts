import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  type WebhookDelivery,
  type WebhookDeliveryPage,
  WebhookDeliveryQuery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookSecret,
} from "@goliveboard/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { etagFor, IfMatchVersion } from "../http/concurrency.js";
import { WebhookDeliveriesService } from "./webhook-deliveries.service.js";
import { WebhookEndpointsService } from "./webhook-endpoints.service.js";

/** docs/04 section 3.7: webhooks are the Owner's. */
@Controller()
@RequireRole("OWNER")
export class WebhooksController {
  constructor(
    private readonly endpoints: WebhookEndpointsService,
    private readonly deliveries: WebhookDeliveriesService,
  ) {}

  @Get("webhook-endpoints")
  list(@CurrentActor() actor: Actor): Promise<WebhookEndpoint[]> {
    return this.endpoints.list(actor);
  }

  /** The secret comes back this once. */
  @Post("webhook-endpoints")
  create(
    @CurrentActor() actor: Actor,
    @Body({ schema: CreateWebhookEndpointRequest })
    body: CreateWebhookEndpointRequest,
  ): Promise<WebhookEndpointCreated> {
    return this.endpoints.create(actor, body);
  }

  @Patch("webhook-endpoints/:endpointId")
  async update(
    @CurrentActor() actor: Actor,
    @Param("endpointId", ParseUUIDPipe) endpointId: string,
    @IfMatchVersion() expectedVersion: number,
    @Body({ schema: UpdateWebhookEndpointRequest })
    body: UpdateWebhookEndpointRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.endpoints.update(
      actor,
      endpointId,
      expectedVersion,
      body,
    );
    response.setHeader("ETag", etagFor(endpoint.version));
    return endpoint;
  }

  @Delete("webhook-endpoints/:endpointId")
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @Param("endpointId", ParseUUIDPipe) endpointId: string,
  ): Promise<void> {
    await this.endpoints.remove(actor, endpointId);
  }

  /** The new secret comes back this once. */
  @Post("webhook-endpoints/:endpointId/rotate-secret")
  @HttpCode(200)
  rotate(
    @CurrentActor() actor: Actor,
    @Param("endpointId", ParseUUIDPipe) endpointId: string,
  ): Promise<WebhookSecret> {
    return this.endpoints.rotateSecret(actor, endpointId);
  }

  @Get("webhook-deliveries")
  listDeliveries(
    @CurrentActor() actor: Actor,
    @Query({ schema: WebhookDeliveryQuery }) query: WebhookDeliveryQuery,
  ): Promise<WebhookDeliveryPage> {
    return this.deliveries.list(actor, query);
  }

  @Post("webhook-deliveries/:deliveryId/redeliver")
  @HttpCode(200)
  redeliver(
    @CurrentActor() actor: Actor,
    @Param("deliveryId", ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return this.deliveries.redeliver(actor, deliveryId);
  }
}
