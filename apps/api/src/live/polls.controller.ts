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
  UseGuards,
} from "@nestjs/common";
import {
  CreatePollRequest,
  type Poll,
  type PollList,
  PollVoteRequest,
  UpdatePollRequest,
} from "@goliveboard/contracts";
import type { Request, Response } from "express";

import {
  type AttendeeActor,
  AttendeeGuard,
  CurrentAttendee,
} from "../attendees/attendee.guard.js";
import {
  type Actor,
  CurrentActor,
  Public,
  RequireRole,
} from "../auth/actor.js";
import { etagFor, IfMatchVersion } from "../http/concurrency.js";
import { requestIdOf } from "../observability/request-id.js";
import { PollsService } from "./polls.service.js";

/** Live polls for staff (FR-RN-8): Managers run them, every role sees them. */
@Controller()
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get("events/:eventId/polls")
  list(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<PollList> {
    return this.polls.listForStaff(actor, eventId);
  }

  @Post("events/:eventId/polls")
  @RequireRole("MANAGER")
  async create(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: CreatePollRequest }) body: CreatePollRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Poll> {
    const poll = await this.polls.create(actor, eventId, body);
    response.setHeader("ETag", etagFor(poll.version));
    return poll;
  }

  @Patch("polls/:pollId")
  @RequireRole("MANAGER")
  async update(
    @CurrentActor() actor: Actor,
    @Param("pollId", ParseUUIDPipe) pollId: string,
    @IfMatchVersion() expectedVersion: number,
    @Body({ schema: UpdatePollRequest }) body: UpdatePollRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Poll> {
    const poll = await this.polls.update(actor, pollId, expectedVersion, body);
    response.setHeader("ETag", etagFor(poll.version));
    return poll;
  }

  @Delete("polls/:pollId")
  @RequireRole("MANAGER")
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @Param("pollId", ParseUUIDPipe) pollId: string,
    @IfMatchVersion() expectedVersion: number,
  ): Promise<void> {
    await this.polls.remove(actor, pollId, expectedVersion);
  }

  @Post("polls/:pollId/open")
  @RequireRole("MANAGER")
  @HttpCode(200)
  open(
    @CurrentActor() actor: Actor,
    @Param("pollId", ParseUUIDPipe) pollId: string,
  ): Promise<Poll> {
    return this.polls.open(actor, pollId);
  }

  @Post("polls/:pollId/close")
  @RequireRole("MANAGER")
  @HttpCode(200)
  close(
    @CurrentActor() actor: Actor,
    @Param("pollId", ParseUUIDPipe) pollId: string,
  ): Promise<Poll> {
    return this.polls.close(actor, pollId);
  }
}

/** Live polls for the attendees the event admits. */
@Public()
@Controller("public/events/:slug/polls")
@UseGuards(AttendeeGuard)
export class AttendeePollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
  ): Promise<PollList> {
    return this.polls.listForAttendee(
      {
        identity: { attendeeSessionId: attendee.sessionId },
        requestId: requestIdOf(request),
      },
      { id: attendee.eventId },
    );
  }

  /** One answer per attendee and poll, final (FR-RN-8). */
  @Put(":pollId/vote")
  @HttpCode(200)
  vote(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
    @Param("pollId", ParseUUIDPipe) pollId: string,
    @Body({ schema: PollVoteRequest }) body: PollVoteRequest,
  ): Promise<Poll> {
    return this.polls.vote(
      {
        identity: { attendeeSessionId: attendee.sessionId },
        requestId: requestIdOf(request),
      },
      { id: attendee.eventId },
      pollId,
      body.optionId,
    );
  }
}
