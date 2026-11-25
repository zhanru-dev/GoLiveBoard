import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import {
  type Accepted,
  type Me,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  SignInRequest,
  SignUpRequest,
  SwitchWorkspaceRequest,
} from "@opspilot/contracts";
import type { Request, Response } from "express";

import { type Actor, CurrentActor, Public } from "./actor.js";
import { AuthService, type RefreshResult } from "./auth.service.js";
import {
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
} from "./cookies.js";
import { MeService } from "./me.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import { DomainError } from "../shared/domain/domain-error.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /** Always `202` with the same body: nothing reveals whether the email was new. */
  @Public()
  @Post("sign-up")
  @HttpCode(202)
  async signUp(
    @Body({ schema: SignUpRequest }) body: SignUpRequest,
    @Req() request: Request,
  ): Promise<Accepted> {
    await this.auth.signUp(body, clientIp(request));
    return { status: "accepted" };
  }

  @Public()
  @Post("sign-in")
  @HttpCode(204)
  async signIn(
    @Body({ schema: SignInRequest }) body: SignInRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setSessionCookies(
      response,
      await this.auth.signIn(body, clientIp(request)),
    );
  }

  /** Demo mode only (FR-AUTH-5); otherwise `404`, as if it did not exist. */
  @Public()
  @Post("demo")
  @HttpCode(204)
  async signInToDemo(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setSessionCookies(
      response,
      await this.auth.signInToDemo(clientIp(request)),
    );
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
    let result: RefreshResult;
    try {
      result = await this.auth.refresh(refreshToken);
    } catch (error) {
      clearSessionCookies(response);
      throw error;
    }
    // A concurrent request already rotated this token. Its response carries
    // the new cookies; answering this one with no cookies at all leaves them
    // in place, where clearing them here would sign the browser out.
    if (result.kind === "rotated") {
      setSessionCookies(response, result.tokens);
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

  /** Always `202` with the same body: nothing reveals whether the account exists. */
  @Public()
  @Post("password-reset/request")
  @HttpCode(202)
  async requestPasswordReset(
    @Body({ schema: PasswordResetRequest }) body: PasswordResetRequest,
    @Req() request: Request,
  ): Promise<Accepted> {
    await this.passwordReset.request(body, clientIp(request));
    return { status: "accepted" };
  }

  @Public()
  @Post("password-reset/confirm")
  @HttpCode(204)
  async confirmPasswordReset(
    @Body({ schema: PasswordResetConfirmRequest })
    body: PasswordResetConfirmRequest,
  ): Promise<void> {
    await this.passwordReset.confirm(body);
  }
}

@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  describe(@CurrentActor() actor: Actor): Promise<Me> {
    return this.me.describe(actor);
  }

  /** FR-WS-4: the next request is scoped to the chosen workspace. */
  @Put("active-workspace")
  switchWorkspace(
    @CurrentActor() actor: Actor,
    @Body({ schema: SwitchWorkspaceRequest }) body: SwitchWorkspaceRequest,
  ): Promise<Me> {
    return this.me.switchWorkspace(actor, body.workspaceId);
  }
}

/**
 * The client's address. Behind Caddy, Express derives it from X-Forwarded-For
 * because `trust proxy` is set to the number of proxies in front of the API.
 */
function clientIp(request: Request): string {
  return request.ip ?? "unknown";
}
