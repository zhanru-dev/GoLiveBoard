import { Controller, Get, Query, Res } from "@nestjs/common";
import { OverviewQuery, type WorkspaceOverview } from "@goliveboard/contracts";
import type { Response } from "express";

import { type Actor, CurrentActor } from "../auth/actor.js";
import { overviewCsv } from "./domain/overview-csv.js";
import { ReportsService } from "./reports.service.js";

/** The workspace's completed events over a span; every role may read it. */
@Controller("reports")
export class WorkspaceReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("overview")
  overview(
    @CurrentActor() actor: Actor,
    @Query({ schema: OverviewQuery }) query: OverviewQuery,
  ): Promise<WorkspaceOverview> {
    return this.reports.overview(actor, query);
  }

  @Get("overview.csv")
  async csv(
    @CurrentActor() actor: Actor,
    @Query({ schema: OverviewQuery }) query: OverviewQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const overview = await this.reports.overview(actor, query);
    response.setHeader("content-type", "text/csv; charset=utf-8");
    // Both are validated dates (YYYY-MM-DD), safe in a header.
    response.setHeader(
      "content-disposition",
      `attachment; filename="overview-${overview.from}-to-${overview.to}.csv"`,
    );
    return overviewCsv(overview);
  }
}
