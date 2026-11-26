import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  type Accepted,
  type AttendeeMe,
  AttendeeVerificationRequest,
  type AttendeeVerified,
  type DemoInbox,
  type PublicEvent,
  RegistrationRequest,
  UnsubscribeRequest,
} from "@goliveboard/contracts";
import type { Request, Response } from "express";

import { Public } from "../auth/actor.js";
import {
  clearAttendeeCookie,
  demoInboxKey,
  readDemoInboxCookie,
  setAttendeeCookie,
} from "./attendee-cookies.js";
import { AttendeeSelfService } from "./attendee-self.service.js";
import {
  type AttendeeActor,
  AttendeeGuard,
  CurrentAttendee,
} from "./attendee.guard.js";
import { RegistrationService } from "./registration.service.js";

/**
 * The public side of an event (docs/04, section 3.5): no staff session.
 * Routes under `events/:slug` that need an attendee session use
 * AttendeeGuard.
 */
@Public()
@Controller("public")
export class PublicController {
  constructor(
    private readonly registrations: RegistrationService,
    private readonly self: AttendeeSelfService,
  ) {}

  @Get("events/:slug")
  event(@Param("slug") slug: string): Promise<PublicEvent> {
    return this.registrations.publicEvent(slug);
  }

  /** Always `202` with the same body: nothing reveals the address's fate. */
  @Post("events/:slug/registrations")
  @HttpCode(202)
  async register(
    @Param("slug") slug: string,
    @Body({ schema: RegistrationRequest }) body: RegistrationRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Accepted> {
    await this.registrations.register(slug, body, clientIp(request), () =>
      demoInboxKey(request, response),
    );
    return { status: "accepted" };
  }

  /** Uses a verification link and sets the attendee session cookie. */
  @Post("attendee-verifications")
  @HttpCode(200)
  async verify(
    @Body({ schema: AttendeeVerificationRequest })
    body: AttendeeVerificationRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttendeeVerified> {
    const grant = await this.registrations.verify(
      body.token,
      clientIp(request),
    );
    setAttendeeCookie(response, grant.token, grant.expiresAt);
    return { slug: grant.slug };
  }

  @Get("events/:slug/me")
  @UseGuards(AttendeeGuard)
  me(@CurrentAttendee() attendee: AttendeeActor): Promise<AttendeeMe> {
    return this.self.me(attendee);
  }

  @Post("events/:slug/sign-out")
  @UseGuards(AttendeeGuard)
  @HttpCode(204)
  async signOut(
    @CurrentAttendee() attendee: AttendeeActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.self.signOut(attendee);
    clearAttendeeCookie(response);
  }

  @Post("reminders/unsubscribe")
  @HttpCode(204)
  async unsubscribe(
    @Body({ schema: UnsubscribeRequest }) body: UnsubscribeRequest,
  ): Promise<void> {
    await this.self.unsubscribe(body.token);
  }

  /** Demo mode only (FR-AUTH-5); otherwise `404`. */
  @Get("demo-inbox")
  demoInbox(@Req() request: Request): Promise<DemoInbox> {
    return this.self.demoInbox(readDemoInboxCookie(request));
  }
}

/** As in AuthController: Express derives it from X-Forwarded-For. */
function clientIp(request: Request): string {
  return request.ip ?? "unknown";
}
