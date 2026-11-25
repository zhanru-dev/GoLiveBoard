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
 * Keeps a live connection's slot: marks it as taken now if it is still
 * there; if it was dropped (a Valkey outage longer than the lease, or a
 * connection let in while Valkey could not count), takes it again only
 * under the limit, like a claim. Returns 0 when there is no room: the
 * connection must close.
 */
const REFRESH_SCRIPT = `${NOW}
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - tonumber(ARGV[1]))
if not redis.call("ZSCORE", KEYS[1], ARGV[3]) and
   redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call("ZADD", KEYS[1], now, ARGV[3])
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

  /**
   * Keeps open connections' slots taken (best effort: if Valkey fails, the
   * next refresh tries again).
   *
   * @returns the connections whose slot was gone and could not be taken
   * again: more were let in meanwhile, and they must close
   */
  async refresh(
    slots: readonly (readonly [string, string])[],
    limit: number,
  ): Promise<(readonly [string, string])[]> {
    if (slots.length === 0) {
      return [];
    }
    const pipeline = this.valkey.pipeline();
    for (const [room, connection] of slots) {
      pipeline.eval(
        REFRESH_SCRIPT,
        1,
        this.key(room),
        SLOT_STALE_MS,
        limit,
        connection,
      );
    }
    const results = await pipeline.exec().catch(() => null);
    if (results === null) {
      return [];
    }
    return slots.filter(
      (_slot, index) => results[index]?.[0] === null && results[index][1] === 0,
    );
  }

  /** Gives a closed connection's slot back; best effort (it goes stale). */
  async release(room: string, connection: string): Promise<void> {
    await this.valkey.zrem(this.key(room), connection).catch(() => undefined);
  }

  private key(room: string): string {
    return `${this.config.realtime.channelPrefix}:realtime:slots:${room}`;
  }
}
