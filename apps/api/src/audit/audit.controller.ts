import { Controller, Get, Query } from "@nestjs/common";
import { type AuditPage, AuditQuery } from "@opspilot/contracts";

import { type Actor, CurrentActor } from "../auth/actor.js";
import { AuditSearchService } from "./audit-search.service.js";

/** docs/04 section 3.7: every member reads the workspace's audit trail. */
@Controller("audit-entries")
export class AuditController {
  constructor(private readonly audit: AuditSearchService) {}

  @Get()
  search(
    @CurrentActor() actor: Actor,
    @Query({ schema: AuditQuery }) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.audit.search(actor, query);
  }
}
