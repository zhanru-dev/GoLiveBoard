import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  TriageDecisionRequest,
  type TriageRun,
  type TriageRunStarted,
} from "@goliveboard/contracts";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { TriageService } from "./triage.service.js";

/** AI question triage (docs/04 section 3.6): moderators, that is Managers. */
@Controller()
@RequireRole("MANAGER")
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @Post("events/:eventId/question-triage-runs")
  @HttpCode(202)
  start(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<TriageRunStarted> {
    return this.triage.start(actor, eventId);
  }

  @Get("events/:eventId/question-triage-runs/latest")
  latest(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<TriageRun> {
    return this.triage.latest(actor, eventId);
  }

  @Get("question-triage-runs/:runId")
  get(
    @CurrentActor() actor: Actor,
    @Param("runId", ParseUUIDPipe) runId: string,
  ): Promise<TriageRun> {
    return this.triage.get(actor, runId);
  }

  @Post("question-triage-runs/:runId/decision")
  @HttpCode(200)
  decide(
    @CurrentActor() actor: Actor,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Body({ schema: TriageDecisionRequest }) body: TriageDecisionRequest,
  ): Promise<TriageRun> {
    return this.triage.decide(actor, runId, body);
  }
}
