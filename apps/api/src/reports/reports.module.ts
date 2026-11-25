import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

/** The post-event report and its CSV (FR-RC-3). */
@Module({
  imports: [DatabaseModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
