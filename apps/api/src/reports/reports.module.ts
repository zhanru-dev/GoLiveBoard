import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { WorkspaceReportsController } from "./workspace-reports.controller.js";

/** The post-event report, the workspace overview, and their CSVs (FR-RC-3, FR-RC-4). */
@Module({
  imports: [DatabaseModule],
  controllers: [ReportsController, WorkspaceReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
