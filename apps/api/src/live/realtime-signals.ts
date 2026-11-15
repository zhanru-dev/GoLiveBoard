import { Inject, Injectable, Module } from "@nestjs/common";
import { EventStatus } from "@opspilot/contracts";
import type { Redis } from "ioredis";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { VALKEY_CLIENT } from "../valkey/valkey.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { RECHECK_SCOPES, type RecheckScope } from "./rooms.js";

/** The Valkey channel every API instance's gateway listens on. */
export const signalsChannel = (config: AppConfig) =>
  `${config.realtime.channelPrefix}:realtime:signals`;

/** At most this many IDs per message; more are sent in several. */
const IDS_PER_SIGNAL = 500;

export const RealtimeSignal = z.discriminatedUnion("type", [
  /**
   * Something that decides access changed: every instance re-checks its
   * connections in the scope now, and disconnects those no longer allowed.
   */
  z.object({
    type: z.literal("recheck"),
    scope: z.enum(RECHECK_SCOPES),
    ids: z.array(z.uuid()).min(1).max(IDS_PER_SIGNAL),
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
export type RealtimeSignal = z.infer<typeof RealtimeSignal>;

/**
 * Tells every API instance's real-time gateway, through Valkey, about
 * changes it must act on at once: a revocation ends live sessions within
 * seconds (FR-AD-4, docs/02, section 7.1), and a status change switches the
 * watch page (FR-RN-1). The API and the worker both send them.
 *
 * Call it after the change has committed. It never throws: if Valkey cannot
 * take the message, the gateway's periodic sweep re-checks every connection
 * within half a minute anyway.
 */
@Injectable()
export class RealtimeSignals {
  constructor(
    @Inject(VALKEY_CLIENT) private readonly valkey: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(RealtimeSignals.name) private readonly logger: PinoLogger,
  ) {}

  async recheck(scope: RecheckScope, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += IDS_PER_SIGNAL) {
      await this.publish({
        type: "recheck",
        scope,
        ids: unique.slice(start, start + IDS_PER_SIGNAL),
      });
    }
  }

  async statusChanged(
    eventId: string,
    slug: string,
    status: EventStatus,
  ): Promise<void> {
    await this.publish({ type: "status", eventId, slug, status });
  }

  private async publish(signal: RealtimeSignal): Promise<void> {
    try {
      await this.valkey.publish(
        signalsChannel(this.config),
        JSON.stringify(signal),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, signal: signal.type },
        "Could not send a real-time signal; the sweep will catch up",
      );
    }
  }
}

/** For every module that changes who may take part in an event. */
@Module({
  imports: [ValkeyModule],
  providers: [RealtimeSignals],
  exports: [RealtimeSignals],
})
export class RealtimeSignalsModule {}
