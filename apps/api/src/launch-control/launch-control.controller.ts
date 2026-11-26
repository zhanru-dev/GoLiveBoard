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
  Put,
  Req,
  Res,
} from "@nestjs/common";
import {
  type AccessPolicy,
  CreateRunbookTaskRequest,
  type EventDetail,
  MoveRunbookTaskRequest,
  PutAccessPolicyRequest,
  type Readiness,
  type RunbookTask,
  TransitionRequest,
  UpdateRunbookTaskRequest,
} from "@goliveboard/contracts";
import type { Request, Response } from "express";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { etagFor, IfMatchVersion } from "../http/concurrency.js";
import { AccessPolicyService } from "./access-policy.service.js";
import { ReadinessService } from "./readiness.service.js";
import { RunbookService } from "./runbook.service.js";
import { TransitionsService } from "./transitions.service.js";

/** Launch Control routes under an event (docs/04 section 3.3). */
@Controller("events/:eventId")
export class EventLaunchControlController {
  constructor(
    private readonly transitions: TransitionsService,
    private readonly readiness: ReadinessService,
    private readonly runbook: RunbookService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  @Post("transitions")
  @RequireRole("MANAGER")
  @HttpCode(200)
  async transition(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: TransitionRequest }) body: TransitionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventDetail> {
    const event = await this.transitions.transition(actor, eventId, body.to);
    response.setHeader("ETag", etagFor(event.version));
    return event;
  }

  @Get("readiness")
  getReadiness(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<Readiness> {
    return this.readiness.assess(actor, eventId);
  }

  @Get("runbook-tasks")
  listTasks(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<RunbookTask[]> {
    return this.runbook.list(actor, eventId);
  }

  @Post("runbook-tasks")
  @RequireRole("MANAGER")
  async createTask(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: CreateRunbookTaskRequest }) body: CreateRunbookTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RunbookTask> {
    const task = await this.runbook.create(actor, eventId, body);
    response.setHeader("ETag", etagFor(task.version));
    return task;
  }

  @Get("access-policy")
  async getAccessPolicy(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessPolicy> {
    const policy = await this.accessPolicy.get(actor, eventId);
    response.setHeader("ETag", etagFor(policy.version));
    return policy;
  }

  @Put("access-policy")
  @RequireRole("MANAGER")
  async putAccessPolicy(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Req() request: Request,
    @Body({ schema: PutAccessPolicyRequest }) body: PutAccessPolicyRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessPolicy> {
    const policy = await this.accessPolicy.put(
      actor,
      eventId,
      request.get("if-match"),
      body,
    );
    response.setHeader("ETag", etagFor(policy.version));
    return policy;
  }
}

/** Routes that address a runbook task by its own ID. */
@Controller("runbook-tasks/:taskId")
export class RunbookTasksController {
  constructor(private readonly runbook: RunbookService) {}

  @Patch()
  @RequireRole("MANAGER")
  async update(
    @CurrentActor() actor: Actor,
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @IfMatchVersion() expectedVersion: number,
    @Body({ schema: UpdateRunbookTaskRequest }) body: UpdateRunbookTaskRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RunbookTask> {
    const task = await this.runbook.update(
      actor,
      taskId,
      expectedVersion,
      body,
    );
    response.setHeader("ETag", etagFor(task.version));
    return task;
  }

  @Delete()
  @RequireRole("MANAGER")
  @HttpCode(204)
  remove(
    @CurrentActor() actor: Actor,
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @IfMatchVersion() expectedVersion: number,
  ): Promise<void> {
    return this.runbook.remove(actor, taskId, expectedVersion);
  }

  @Post("move")
  @RequireRole("MANAGER")
  @HttpCode(200)
  move(
    @CurrentActor() actor: Actor,
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Body({ schema: MoveRunbookTaskRequest }) body: MoveRunbookTaskRequest,
  ): Promise<RunbookTask[]> {
    return this.runbook.move(actor, taskId, body.after);
  }
}
