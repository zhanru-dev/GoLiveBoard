import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  CreateEventRequest,
  type EventDetail,
  type EventPage,
  ListEventsQuery,
  UpdateEventRequest,
} from "@goliveboard/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { API_PREFIX } from "../http/api-prefix.js";
import { etagFor, IfMatchVersion } from "../http/concurrency.js";
import { IdempotencyKey } from "../idempotency/idempotency.js";
import { EventsService } from "./events.service.js";

@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query({ schema: ListEventsQuery }) query: ListEventsQuery,
  ): Promise<EventPage> {
    return this.events.list(actor, query);
  }

  @Post()
  @RequireRole("MANAGER")
  async create(
    @CurrentActor() actor: Actor,
    @Body({ schema: CreateEventRequest }) body: CreateEventRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventDetail> {
    const { event } = await this.events.create(actor, body, idempotencyKey);
    response
      .status(201)
      .location(`/${API_PREFIX}/events/${event.id}`)
      .setHeader("ETag", etagFor(event.version));
    return event;
  }

  @Get(":eventId")
  async get(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventDetail> {
    const event = await this.events.get(actor, eventId);
    response.setHeader("ETag", etagFor(event.version));
    return event;
  }

  @Patch(":eventId")
  @RequireRole("MANAGER")
  async update(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @IfMatchVersion() expectedVersion: number,
    @Body({ schema: UpdateEventRequest }) body: UpdateEventRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventDetail> {
    const event = await this.events.update(
      actor,
      eventId,
      expectedVersion,
      body,
    );
    response.setHeader("ETag", etagFor(event.version));
    return event;
  }
}
