import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Res,
} from "@nestjs/common";
import type { LiveOps } from "@goliveboard/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor } from "../auth/actor.js";
import { LiveOpsService } from "./live-ops.service.js";
import { LiveOpsStreams } from "./live-ops-streams.js";

/** The operations room (FR-RN-7): every role may watch it. */
@Controller("events/:eventId/live-ops")
export class LiveOpsController {
  constructor(
    private readonly liveOps: LiveOpsService,
    private readonly streams: LiveOpsStreams,
  ) {}

  @Get()
  snapshot(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<LiveOps> {
    return this.liveOps.snapshot(actor, eventId);
  }

  @Get("stream")
  stream(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    return this.streams.start(actor, eventId, lastEventId, response);
  }
}
