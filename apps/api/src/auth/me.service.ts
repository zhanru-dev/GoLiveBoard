import { Inject, Injectable } from "@nestjs/common";
import type { Me } from "@opspilot/contracts";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
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
}
