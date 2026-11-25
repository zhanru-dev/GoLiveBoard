import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  type AttendeeInvitation,
  type AttendeePage,
  AttendeeQuery,
  CreateAttendeeInvitationRequest,
  type StaffAttendee,
} from "@opspilot/contracts";

import { type Actor, CurrentActor, RequireRole } from "../auth/actor.js";
import { AudienceService } from "./audience.service.js";

/** docs/04, section 3.4: attendees and invitations, as staff see them. */
@Controller()
export class AudienceController {
  constructor(private readonly audience: AudienceService) {}

  @Get("events/:eventId/attendees")
  list(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query({ schema: AttendeeQuery }) query: AttendeeQuery,
  ): Promise<AttendeePage> {
    return this.audience.list(actor, eventId, query);
  }

  @Post("events/:eventId/attendees/:attendeeId/revoke")
  @RequireRole("MANAGER")
  @HttpCode(200)
  revoke(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("attendeeId", ParseUUIDPipe) attendeeId: string,
  ): Promise<StaffAttendee> {
    return this.audience.revoke(actor, eventId, attendeeId);
  }

  @Post("events/:eventId/attendees/:attendeeId/erase")
  @RequireRole("MANAGER")
  @HttpCode(200)
  erase(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("attendeeId", ParseUUIDPipe) attendeeId: string,
  ): Promise<StaffAttendee> {
    return this.audience.erase(actor, eventId, attendeeId);
  }

  @Get("events/:eventId/invitations")
  @RequireRole("MANAGER")
  invitations(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<AttendeeInvitation[]> {
    return this.audience.invitations(actor, eventId);
  }

  @Post("events/:eventId/invitations")
  @RequireRole("MANAGER")
  invite(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body({ schema: CreateAttendeeInvitationRequest })
    body: CreateAttendeeInvitationRequest,
  ): Promise<AttendeeInvitation> {
    return this.audience.invite(actor, eventId, body.email);
  }

  @Delete("event-invitations/:invitationId")
  @RequireRole("MANAGER")
  @HttpCode(204)
  revokeInvitation(
    @CurrentActor() actor: Actor,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.audience.revokeInvitation(actor, invitationId);
  }
}
