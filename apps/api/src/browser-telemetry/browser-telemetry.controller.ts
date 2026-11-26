import { BrowserTelemetryRequest } from "@goliveboard/contracts";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { Public } from "../auth/actor.js";
import { BrowserTelemetryService } from "./browser-telemetry.service.js";

/**
 * Measurements from visitors' browsers (docs/06, section 7): Core Web
 * Vitals on real visits, and real-time connections that failed. No session
 * is needed and nothing personal is taken; the answer is always 204, also
 * when a measurement is dropped, so the browser's beacon is never retried.
 */
@Public()
@Controller("browser-telemetry")
export class BrowserTelemetryController {
  constructor(private readonly telemetry: BrowserTelemetryService) {}

  @Post()
  @HttpCode(204)
  async record(
    @Body({ schema: BrowserTelemetryRequest }) body: BrowserTelemetryRequest,
    @Req() request: Request,
  ): Promise<void> {
    await this.telemetry.record(body, request.ip ?? "unknown");
  }
}
