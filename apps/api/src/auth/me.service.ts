import { Inject, Injectable } from "@nestjs/common";
import type { Me } from "@opspilot/contracts";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { DomainError } from "../shared/domain/domain-error.js";
import type { Actor } from "./actor.js";

@Injectable()
export class MeService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async describe(actor: Actor): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: {
        memberships: {
          include: { workspace: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const memberships = user.memberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
      role: membership.role,
    }));
    const activeWorkspace = memberships.find(
      (membership) => membership.workspaceId === actor.workspaceId,
    );
    if (activeWorkspace === undefined) {
      // SessionGuard has just confirmed this membership.
      throw new Error("Active workspace membership disappeared");
    }
    return {
      user: { id: user.id, name: user.name, email: user.email },
      activeWorkspace,
      memberships,
    };
  }

  /**
   * Points the session at another workspace the user belongs to. A workspace
   * the user is not a member of is reported as not found, never as forbidden,
   * so its existence is not revealed.
   */
  async switchWorkspace(actor: Actor, workspaceId: string): Promise<Me> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
      select: { id: true },
    });
    if (membership === null) {
      throw new DomainError("NOT_FOUND");
    }
    await this.prisma.session.update({
      where: { id: actor.sessionId },
      data: { activeWorkspaceId: workspaceId },
    });
    return this.describe({ ...actor, workspaceId });
  }
}
