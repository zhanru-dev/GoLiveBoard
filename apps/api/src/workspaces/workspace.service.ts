import { Inject, Injectable } from "@nestjs/common";
import type { UpdateWorkspaceRequest, Workspace } from "@opspilot/contracts";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";

const WORKSPACE_FIELDS = { id: true, name: true, retentionDays: true } as const;

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

  update(actor: Actor, changes: UpdateWorkspaceRequest): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id: actor.workspaceId },
      data: changes,
      select: WORKSPACE_FIELDS,
    });
  }
}
