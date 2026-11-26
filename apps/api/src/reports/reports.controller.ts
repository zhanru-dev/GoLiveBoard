import { Controller, Get, Param, ParseUUIDPipe, Res } from "@nestjs/common";
import type { EventReport } from "@goliveboard/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor } from "../auth/actor.js";
import { reportCsv } from "./domain/report-csv.js";
import { ReportsService } from "./reports.service.js";

/** FR-RC-3: every role may read and export the report. */
@Controller("events/:eventId")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("report")
  report(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ): Promise<EventReport> {
    return this.reports.report(actor, eventId);
  }

  @Get("report.csv")
  async csv(
    @CurrentActor() actor: Actor,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.reports.report(actor, eventId);
    response.setHeader("content-type", "text/csv; charset=utf-8");
    // Slugs are made of [a-z0-9-]; filtered again, as it goes in a header.
    const name = report.event.slug.replace(/[^a-z0-9-]/g, "");
    response.setHeader(
      "content-disposition",
      `attachment; filename="report-${name}.csv"`,
    );
    return reportCsv(report);
  }
}
