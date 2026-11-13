import { Inject, Injectable } from "@nestjs/common";
import type { AccessPolicy, PutAccessPolicyRequest } from "@opspilot/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { lockWritableEvent } from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { versionFromIfMatch } from "../http/concurrency.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

const POLICY_SELECT = {
  mode: true,
  allowedDomains: true,
  privacyNoticeVersion: true,
  version: true,
  updatedAt: true,
} as const;

function toAccessPolicy(row: {
  mode: AccessPolicy["mode"];
  allowedDomains: string[];
  privacyNoticeVersion: string;
  version: number;
  updatedAt: Date;
}): AccessPolicy {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Who may register for an event (FR-AD-2); its absence is a hard blocker. */
@Injectable()
export class AccessPolicyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @throws DomainError `NOT_FOUND` when the event has no policy yet */
  async get(actor: Actor, eventId: string): Promise<AccessPolicy> {
    const row = await this.prisma.accessPolicy.findFirst({
      where: { eventId, event: { workspaceId: actor.workspaceId } },
      select: POLICY_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND", {
        detail: "No access policy has been set for this event.",
      });
    }
    return toAccessPolicy(row);
  }

  /**
   * Sets the policy. The first PUT creates it and must not send `If-Match`
   * (there is no version to match yet); every later PUT replaces it and must
   * send the current version. Two first PUTs at once are serialised by the
   * event lock: the second finds the policy and is asked for `If-Match`.
   *
   * @param ifMatch - the raw `If-Match` header, or `undefined`
   */
  async put(
    actor: Actor,
    eventId: string,
    ifMatch: string | undefined,
    input: PutAccessPolicyRequest,
  ): Promise<AccessPolicy> {
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      const current = await tx.accessPolicy.findUnique({
        where: { eventId },
        select: POLICY_SELECT,
      });
      const now = this.clock.now();
      if (current === null) {
        if (ifMatch !== undefined) {
          throw new DomainError("VERSION_CONFLICT", {
            detail: "The event has no access policy yet; send no If-Match.",
          });
        }
        const created = await tx.accessPolicy.create({
          data: { eventId, ...input, updatedAt: now },
          select: POLICY_SELECT,
        });
        await this.audit(tx, actor, eventId, undefined, input);
        return toAccessPolicy(created);
      }
      if (versionFromIfMatch(ifMatch) !== current.version) {
        throw new DomainError("VERSION_CONFLICT");
      }
      const updated = await tx.accessPolicy.update({
        where: { eventId },
        data: { ...input, version: { increment: 1 }, updatedAt: now },
        select: POLICY_SELECT,
      });
      await this.audit(tx, actor, eventId, current, input);
      return toAccessPolicy(updated);
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    eventId: string,
    before: PutAccessPolicyRequest | undefined,
    after: PutAccessPolicyRequest,
  ): Promise<void> {
    const snapshot = (policy: PutAccessPolicyRequest) => ({
      mode: policy.mode,
      allowedDomains: policy.allowedDomains,
      privacyNoticeVersion: policy.privacyNoticeVersion,
    });
    await recordAudit(tx, actor, {
      action: "access_policy.updated",
      targetType: "event",
      targetId: eventId,
      eventId,
      ...(before !== undefined && { before: snapshot(before) }),
      after: snapshot(after),
    });
  }
}
