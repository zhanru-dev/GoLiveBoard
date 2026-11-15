import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { VALKEY_CLIENT } from "../valkey/valkey.js";

/** A slot no instance has refreshed for this long is free again. */
export const SLOT_STALE_MS = 60_000;
/** How often instances refresh the slots of their open connections. */
export const SLOT_REFRESH_MS = 20_000;

/**
 * Takes a slot if fewer than `limit` live ones are taken, in one step: of
 * many handshakes at once, on any instances, exactly `limit` succeed.
 * Slots not refreshed for `stale` ms (an instance that died) are dropped
 * first.
 */
const CLAIM_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - tonumber(ARGV[2]))
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  return 0
end
redis.call("ZADD", KEYS[1], now, ARGV[4])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
return 1`;

/**
 * Bounds the real-time connections one session holds open across every API
 * instance (docs/04, section 4). Each connection holds a slot in a Valkey
 * sorted set, taken atomically at the handshake, refreshed while it lives
 * and given back when it closes.
 */
@Injectable()
export class ConnectionSlots {
  constructor(
    @Inject(VALKEY_CLIENT) private readonly valkey: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * @returns whether the slot was taken, or undefined when Valkey could not
   * say (the caller then counts this instance's connections alone)
   */
  async claim(
    room: string,
    connection: string,
    limit: number,
  ): Promise<boolean | undefined> {
    try {
      const taken = await this.valkey.eval(
        CLAIM_SCRIPT,
        1,
        this.key(room),
        Date.now(),
        SLOT_STALE_MS,
        limit,
        connection,
      );
      return taken === 1;
    } catch {
      return undefined;
    }
  }

  /** Keeps open connections' slots taken; best effort. */
  async refresh(slots: readonly (readonly [string, string])[]): Promise<void> {
    if (slots.length === 0) {
      return;
    }
    const now = Date.now();
    const pipeline = this.valkey.pipeline();
    for (const [room, connection] of slots) {
      pipeline.zadd(this.key(room), "XX", now, connection);
      pipeline.pexpire(this.key(room), SLOT_STALE_MS);
    }
    await pipeline.exec().catch(() => undefined);
  }

  /** Gives a closed connection's slot back; best effort (it goes stale). */
  async release(room: string, connection: string): Promise<void> {
    await this.valkey.zrem(this.key(room), connection).catch(() => undefined);
  }

  private key(room: string): string {
    return `${this.config.realtime.channelPrefix}:realtime:slots:${room}`;
  }
}
