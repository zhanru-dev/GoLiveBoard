import { Injectable, Module } from "@nestjs/common";
import { EventStatus } from "@goliveboard/contracts";
import { z } from "zod";

import type { Prisma } from "../generated/prisma/client.js";
import { RECHECK_SCOPES, type RecheckScope } from "./rooms.js";

/** At most this many IDs per row; more are written as several. */
const IDS_PER_CHANGE = 500;

export const AccessChangeBody = z.discriminatedUnion("type", [
  /**
   * Something that decides access changed: every instance re-checks its
   * connections in the scope, and disconnects those no longer allowed.
   */
  z.object({
    type: z.literal("recheck"),
    scope: z.enum(RECHECK_SCOPES),
    ids: z.array(z.uuid()).min(1).max(IDS_PER_CHANGE),
  }),
  /** An event's status changed (and its connections are re-checked too). */
  z.object({
    type: z.literal("status"),
    eventId: z.uuid(),
    /** What clients call the event: sent as is, whoever is connected. */
    slug: z.string().min(1).max(100),
    status: EventStatus,
  }),
]);
export type AccessChangeBody = z.infer<typeof AccessChangeBody>;

/**
 * Records changes the real-time gateways must act on: a revocation ends live
 * connections within seconds (FR-AD-4, docs/02, section 7.6), and a status
 * change switches the watch page (FR-RN-1).
 *
 * Written in the transaction that makes the change, so it exists exactly
 * when the change does, whatever fails afterwards. Every API instance reads
 * the recent rows every second (RealtimeGateway); nothing depends on a
 * message broker.
 */
@Injectable()
export class RealtimeSignals {
  async recheck(
    tx: Prisma.TransactionClient,
    scope: RecheckScope,
    ids: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += IDS_PER_CHANGE) {
      await record(tx, {
        type: "recheck",
        scope,
        ids: unique.slice(start, start + IDS_PER_CHANGE),
      });
    }
  }

  async statusChanged(
    tx: Prisma.TransactionClient,
    eventId: string,
    slug: string,
    status: EventStatus,
  ): Promise<void> {
    await record(tx, { type: "status", eventId, slug, status });
  }
}

async function record(
  tx: Prisma.TransactionClient,
  change: AccessChangeBody,
): Promise<void> {
  await tx.accessChange.create({ data: { change } });
}

/** For every module that changes who may take part in an event. */
@Module({
  providers: [RealtimeSignals],
  exports: [RealtimeSignals],
})
export class RealtimeSignalsModule {}
