import { Inject, Injectable } from "@nestjs/common";
import type { Member, Role } from "@goliveboard/contracts";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { RealtimeSignals } from "../live/realtime-signals.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

type Transaction = Prisma.TransactionClient;

@Injectable()
export class MembersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly signals: RealtimeSignals,
  ) {}

  async list(actor: Actor): Promise<Member[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    }));
  }

  /** FR-WS-3: takes effect on the member's next request; the last Owner stays. */
  async changeRole(
    actor: Actor,
    membershipId: string,
    role: Role,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.lockMembership(tx, actor, membershipId);
      if (membership.role === "OWNER" && role !== "OWNER") {
        await this.assertAnotherOwner(tx, actor.workspaceId, membershipId);
      }
      await tx.membership.update({
        where: { id: membershipId },
        data: { role },
      });
      // Live connections pick up the new role (moderation rights).
      await this.signals.recheck(tx, "user", [membership.userId]);
    });
  }

  /** Removes the member and ends their sessions in this workspace at once. */
  async remove(actor: Actor, membershipId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await this.lockMembership(tx, actor, membershipId);
      if (membership.role === "OWNER") {
        await this.assertAnotherOwner(tx, actor.workspaceId, membershipId);
      }
      await tx.membership.delete({ where: { id: membershipId } });
      await tx.session.updateMany({
        where: {
          userId: membership.userId,
          activeWorkspaceId: actor.workspaceId,
          revokedAt: null,
        },
        data: { revokedAt: this.clock.now() },
      });
      await this.signals.recheck(tx, "user", [membership.userId]);
    });
  }

  /** FR-AUTH-3: an Owner signs a member out of every browser. */
  async signOutEverywhere(actor: Actor, membershipId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, workspaceId: actor.workspaceId },
      select: { userId: true },
    });
    if (membership === null) {
      throw new DomainError("NOT_FOUND");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      await this.signals.recheck(tx, "user", [membership.userId]);
    });
  }

  /**
   * Loads a membership of the actor's workspace and locks every Owner row of
   * that workspace (SELECT … FOR UPDATE). Two Owners demoting each other at
   * the same moment are then handled one after the other, so the second sees
   * that it would remove the last Owner.
   */
  private async lockMembership(
    tx: Transaction,
    actor: Actor,
    membershipId: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM memberships
      WHERE workspace_id = ${actor.workspaceId}::uuid AND (role = 'OWNER' OR id = ${membershipId}::uuid)
      FOR UPDATE`;
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, workspaceId: actor.workspaceId },
    });
    if (membership === null) {
      // Another workspace's membership is "not found", never "forbidden".
      throw new DomainError("NOT_FOUND");
    }
    return membership;
  }

  private async assertAnotherOwner(
    tx: Transaction,
    workspaceId: string,
    exceptId: string,
  ) {
    const otherOwners = await tx.membership.count({
      where: { workspaceId, role: "OWNER", id: { not: exceptId } },
    });
    if (otherOwners === 0) {
      throw new DomainError("OWNER_REQUIRED");
    }
  }
}
