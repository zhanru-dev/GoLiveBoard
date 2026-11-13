import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  type Accepted,
  type Me,
  SignInRequest,
  SignUpRequest,
} from "@opspilot/contracts";
import type { Request, Response } from "express";

import { type Actor, CurrentActor, Public } from "./actor.js";
import { AuthService } from "./auth.service.js";
import {
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
} from "./cookies.js";
import { MeService } from "./me.service.js";
import { DomainError } from "../shared/domain/domain-error.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Always `202` with the same body: nothing reveals whether the email was new. */
  @Public()
  @Post("sign-up")
  @HttpCode(202)
  async signUp(
    @Body({ schema: SignUpRequest }) body: SignUpRequest,
  ): Promise<Accepted> {
    await this.auth.signUp(body);
    return { status: "accepted" };
  }

  @Public()
  @Post("sign-in")
  @HttpCode(204)
  async signIn(
    @Body({ schema: SignInRequest }) body: SignInRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setSessionCookies(response, await this.auth.signIn(body));
  }

  @Public()
  @Post("refresh")
  @HttpCode(204)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = readRefreshCookie(request);
    if (refreshToken === undefined) {
      throw new DomainError("UNAUTHENTICATED");
    }
    try {
      setSessionCookies(response, await this.auth.refresh(refreshToken));
    } catch (error) {
      clearSessionCookies(response);
      throw error;
    }
  }

  /** Works with an expired access token: the refresh cookie names the session. */
  @Public()
  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = readRefreshCookie(request);
    if (refreshToken !== undefined) {
      await this.auth.signOut(refreshToken);
    }
    clearSessionCookies(response);
  }
}

@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  describe(@CurrentActor() actor: Actor): Promise<Me> {
    return this.me.describe(actor);
  }
}
