import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { VALKEY_CLIENT } from "../valkey/valkey.js";

/** A slot no instance has refreshed for this long is free again. */
export const SLOT_STALE_MS = 60_000;
/** How often instances refresh the slots of their open connections. */
export const SLOT_REFRESH_MS = 20_000;

/**
 * Valkey's own clock, in milliseconds: every instance's slots are timed by
 * the same clock, however far the instances' clocks drift apart.
 */
const NOW = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)`;

/**
 * Takes a slot if fewer than `limit` live ones are taken, in one step: of
 * many handshakes at once, on any instances, exactly `limit` succeed.
 * Slots not refreshed for ARGV[1] ms (an instance that died) are dropped
 * first.
 */
const CLAIM_SCRIPT = `${NOW}
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - tonumber(ARGV[1]))
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call("ZADD", KEYS[1], now, ARGV[3])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]))
return 1`;

/**
 * Marks a live connection's slot as taken now, adding it back if it was
 * dropped (after a Valkey outage longer than the lease, or a connection
 * let in while Valkey could not count).
 */
const REFRESH_SCRIPT = `${NOW}
redis.call("ZADD", KEYS[1], now, ARGV[2])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]))
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
    const pipeline = this.valkey.pipeline();
    for (const [room, connection] of slots) {
      pipeline.eval(
        REFRESH_SCRIPT,
        1,
        this.key(room),
        SLOT_STALE_MS,
        connection,
      );
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
