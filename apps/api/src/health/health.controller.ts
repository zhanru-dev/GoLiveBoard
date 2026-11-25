import { Controller, Get, Header, HttpStatus, Res } from "@nestjs/common";
import type { HealthReport, LivenessReport } from "@opspilot/contracts";
import type { Response } from "express";

import { Public } from "../auth/actor.js";
import { HealthService } from "./health.service.js";

/** Public: load balancers and uptime checks call these without a session. */
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** The process is running. Used to decide whether to restart it. */
  @Get("live")
  @Header("Cache-Control", "no-store")
  live(): LivenessReport {
    return { status: "ok" };
  }

  /**
   * The API can serve requests. Used to decide whether to send it traffic;
   * answers `503` while any dependency is down.
   */
  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthReport> {
    const report = await this.health.checkReadiness();
    if (report.status === "unavailable") {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
