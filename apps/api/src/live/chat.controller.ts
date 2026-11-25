import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type ChatMessage,
  type ChatPage,
  ChatPageQuery,
} from "@opspilot/contracts";

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
import { ChatService } from "./chat.service.js";

/** Chat history and moderation (docs/04, section 3.6). */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("events/:eventId/chat/messages")
  history(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query({ schema: ChatPageQuery }) query: ChatPageQuery,
  ): Promise<ChatPage> {
    return this.chat.historyForStaff(actor, eventId, query);
  }

  /** FR-RN-3: the text goes for everyone; a tombstone and an audit entry stay. */
  @Delete("events/:eventId/chat/messages/:messageId")
  @RequireRole("MANAGER")
  @HttpCode(200)
  delete(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
  ): Promise<ChatMessage> {
    return this.chat.delete(actor, eventId, messageId);
  }

  /** The same history, for an attendee the event admits. */
  @Public()
  @Get("public/events/:slug/chat/messages")
  @UseGuards(AttendeeGuard)
  attendeeHistory(
    @CurrentAttendee() attendee: AttendeeActor,
    @Query({ schema: ChatPageQuery }) query: ChatPageQuery,
  ): Promise<ChatPage> {
    return this.chat.history(attendee.eventId, query);
  }
}
