import { Inject, Injectable } from "@nestjs/common";
import type { UpdateWorkspaceRequest, Workspace } from "@opspilot/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";

const WORKSPACE_FIELDS = {
  id: true,
  name: true,
  retentionDays: true,
  webhooksIncludePersonalData: true,
} as const;

/** The active workspace's settings. Every query is scoped by the actor. */
@Injectable()
export class WorkspaceService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  get(actor: Actor): Promise<Workspace> {
    return this.prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspaceId },
      select: WORKSPACE_FIELDS,
    });
  }

  /** Audited: retention and personal data in webhooks are privacy settings. */
  update(actor: Actor, changes: UpdateWorkspaceRequest): Promise<Workspace> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.workspace.findUniqueOrThrow({
        where: { id: actor.workspaceId },
        select: WORKSPACE_FIELDS,
      });
      const after = await tx.workspace.update({
        where: { id: actor.workspaceId },
        data: changes,
        select: WORKSPACE_FIELDS,
      });
      const changed = (Object.keys(changes) as (keyof typeof changes)[]).filter(
        (field) => before[field] !== after[field],
      );
      if (changed.length > 0) {
        await recordAudit(tx, actor, {
          action: "workspace.updated",
          targetType: "workspace",
          targetId: actor.workspaceId,
          before: Object.fromEntries(
            changed.map((field) => [field, before[field]]),
          ),
          after: Object.fromEntries(
            changed.map((field) => [field, after[field]]),
          ),
        });
      }
      return after;
    });
  }
}
