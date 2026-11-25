import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { AuditController } from "./audit.controller.js";
import { AuditSearchService } from "./audit-search.service.js";

/** The audit trail's search (FR-RC-1); entries are written by each change. */
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditSearchService],
})
export class AuditModule {}
