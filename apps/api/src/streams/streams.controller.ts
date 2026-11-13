import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import {
  type EventDetail,
  type Incident,
  PageQuery,
  SetStreamRequest,
  type StreamCheckPage,
} from "@opspilot/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { etagFor } from "../http/concurrency.js";
import { StreamsService } from "./streams.service.js";

@Controller("events/:eventId")
export class StreamsController {
  constructor(private readonly streams: StreamsService) {}

  @Put("stream")
  @RequireRole("MANAGER")
  async setStream(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: SetStreamRequest }) body: SetStreamRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventDetail> {
    const event = await this.streams.setStream(actor, eventId, body.url);
    response.setHeader("ETag", etagFor(event.version));
    return event;
  }

  @Get("stream/checks")
  listChecks(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query({ schema: PageQuery }) query: PageQuery,
  ): Promise<StreamCheckPage> {
    return this.streams.listChecks(actor, eventId, query);
  }

  @Post("stream/checks")
  @RequireRole("MANAGER")
  @HttpCode(202)
  requestCheck(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<void> {
    return this.streams.requestCheck(actor, eventId);
  }

  @Get("incidents")
  listIncidents(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<Incident[]> {
    return this.streams.listIncidents(actor, eventId);
  }
}
