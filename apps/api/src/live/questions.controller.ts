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
  AskQuestionRequest,
  ModerateQuestionRequest,
  type Question,
  type QuestionList,
} from "@opspilot/contracts";
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
import { IdempotencyKey } from "../idempotency/idempotency.js";
import { requestIdOf } from "../observability/request-id.js";
import { QuestionsService, type Viewer } from "./questions.service.js";

const staff = (actor: Actor): Viewer => ({
  identity: { staffSessionId: actor.sessionId },
  requestId: actor.requestId,
});

const attendeeViewer = (attendee: AttendeeActor, request: Request): Viewer => ({
  identity: { attendeeSessionId: attendee.sessionId },
  requestId: requestIdOf(request),
});

/** Q&A for staff (docs/04, section 3.6). */
@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get("events/:eventId/questions")
  list(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<QuestionList> {
    return this.questions.list(staff(actor), { id: eventId });
  }

  @Post("events/:eventId/questions")
  @RequireRole("MANAGER")
  async ask(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: AskQuestionRequest }) body: AskQuestionRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Question> {
    const { question } = await this.questions.ask(
      staff(actor),
      { id: eventId },
      body.body,
      idempotencyKey,
    );
    response.status(201).setHeader("ETag", etagFor(question.version));
    return question;
  }

  /** FR-RN-5: approve, hide, mark answered, pin or unpin. */
  @Patch("questions/:questionId")
  @RequireRole("MANAGER")
  async moderate(
    @CurrentActor() actor: Actor,
    @Param("questionId", ParseUUIDPipe) questionId: string,
    @IfMatchVersion() expectedVersion: number,
    @Body({ schema: ModerateQuestionRequest }) body: ModerateQuestionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Question> {
    const question = await this.questions.moderate(
      actor,
      questionId,
      expectedVersion,
      body,
    );
    response.setHeader("ETag", etagFor(question.version));
    return question;
  }
}

/** Q&A for attendees the event admits. */
@Public()
@Controller("public/events/:slug/questions")
@UseGuards(AttendeeGuard)
export class AttendeeQuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  list(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
  ): Promise<QuestionList> {
    return this.questions.list(attendeeViewer(attendee, request), {
      id: attendee.eventId,
    });
  }

  @Post()
  async ask(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
    @Body({ schema: AskQuestionRequest }) body: AskQuestionRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Question> {
    const { question } = await this.questions.ask(
      attendeeViewer(attendee, request),
      { id: attendee.eventId },
      body.body,
      idempotencyKey,
    );
    response.status(201);
    return question;
  }

  /** One vote per attendee; voting again changes nothing (FR-RN-4). */
  @Put(":questionId/vote")
  @HttpCode(200)
  vote(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
    @Param("questionId", ParseUUIDPipe) questionId: string,
  ): Promise<Question> {
    return this.questions.vote(
      attendeeViewer(attendee, request),
      { id: attendee.eventId },
      questionId,
      true,
    );
  }

  @Delete(":questionId/vote")
  @HttpCode(200)
  unvote(
    @CurrentAttendee() attendee: AttendeeActor,
    @Req() request: Request,
    @Param("questionId", ParseUUIDPipe) questionId: string,
  ): Promise<Question> {
    return this.questions.vote(
      attendeeViewer(attendee, request),
      { id: attendee.eventId },
      questionId,
      false,
    );
  }
}
