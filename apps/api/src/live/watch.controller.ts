import { Controller, Get, UseGuards } from "@nestjs/common";
import type { WatchInfo } from "@opspilot/contracts";

import {
  type AttendeeActor,
  AttendeeGuard,
  CurrentAttendee,
} from "../attendees/attendee.guard.js";
import { Public } from "../auth/actor.js";
import { WatchService } from "./watch.service.js";

/** The watch page's data, for an attendee the event admits (FR-RN-1). */
@Public()
@Controller("public/events/:slug/watch")
@UseGuards(AttendeeGuard)
export class WatchController {
  constructor(private readonly watch: WatchService) {}

  @Get()
  info(@CurrentAttendee() attendee: AttendeeActor): Promise<WatchInfo> {
    return this.watch.info(attendee.eventId);
  }
}
