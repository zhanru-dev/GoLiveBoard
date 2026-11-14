import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { DomainError } from "../shared/domain/domain-error.js";
import { VALKEY_CLIENT } from "../valkey/valkey.js";

/** A limit: at most `limit` events per `windowMs` for one key. */
export interface RateLimitRule {
  /** Short name that becomes part of the Valkey key, e.g. `sign-in:ip`. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The limits in docs/04 and docs/02 (section 7.1). */
export const RATE_LIMITS = {
  /** Failed sign-ins, counted per account and per address (FR-AUTH-1). */
  signInFailuresPerAccount: {
    name: "sign-in-failures:account",
    limit: 10,
    windowMs: 15 * MINUTE_MS,
  },
  signInFailuresPerIp: {
    name: "sign-in-failures:ip",
    limit: 10,
    windowMs: 15 * MINUTE_MS,
  },
  signUpPerIp: { name: "sign-up:ip", limit: 10, windowMs: HOUR_MS },
  /** Each demo sign-in starts a session; a person needs a handful at most. */
  demoSignInPerIp: { name: "demo-sign-in:ip", limit: 20, windowMs: HOUR_MS },
  passwordResetPerIp: {
    name: "password-reset:ip",
    limit: 10,
    windowMs: HOUR_MS,
  },
  /** Silently enforced: answering differently would reveal the account exists. */
  passwordResetPerAccount: {
    name: "password-reset:account",
    limit: 3,
    windowMs: HOUR_MS,
  },
  /** "Check now" on one event's stream; checks already run every 30 s. */
  streamCheckPerEvent: {
    name: "stream-check:event",
    limit: 6,
    windowMs: MINUTE_MS,
  },
} satisfies Record<string, RateLimitRule>;

const KEY_PREFIX = "opspilot:rate";

/** Decrements a counter only if it still exists and is above zero. */
const REFUND_SCRIPT = `
if (tonumber(redis.call("GET", KEYS[1]) or "0") > 0) then
  return redis.call("DECR", KEYS[1])
end
return 0`;

/**
 * Fixed-window counters in Valkey, shared by every API process. If Valkey is
 * unreachable the limits are skipped (fail open) and the outage is logged:
 * losing brute-force protection for a while is better than locking everyone
 * out, and the readiness check reports the outage anyway.
 */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(VALKEY_CLIENT) private readonly valkey: Redis,
    @InjectPinoLogger(RateLimiter.name) private readonly logger: PinoLogger,
  ) {}

  /** Counts one event; true while the key is within its limit. */
  async consume(rule: RateLimitRule, subject: string): Promise<boolean> {
    const count = await this.increment(rule, subject);
    return count === undefined || count <= rule.limit;
  }

  /** Like consume, but answers an exceeded limit with 429. */
  async consumeOrThrow(rule: RateLimitRule, subject: string): Promise<void> {
    if (!(await this.consume(rule, subject))) {
      throw rateLimited(rule);
    }
  }

  /** Forgets the key, e.g. an account's failures after a successful sign-in. */
  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.run(() => this.valkey.del(keyFor(rule, subject)));
  }

  /**
   * Gives back one event counted by consume, for an attempt that turned out
   * not to count (a successful sign-in). A window that has already ended is
   * left alone, so a refund never creates a key without an expiry.
   */
  async refund(rule: RateLimitRule, subject: string): Promise<void> {
    await this.run(() =>
      this.valkey.eval(REFUND_SCRIPT, 1, keyFor(rule, subject)),
    );
  }

  private async increment(rule: RateLimitRule, subject: string) {
    const key = keyFor(rule, subject);
    return this.run(async () => {
      // One round trip, applied atomically: count, and start the window on
      // the first event only (NX keeps later events from extending it).
      const results = await this.valkey
        .multi()
        .incr(key)
        .pexpire(key, rule.windowMs, "NX")
        .exec();
      const count = results?.[0]?.[1];
      return typeof count === "number" ? count : undefined;
    });
  }

  private async run<T>(command: () => Promise<T>): Promise<T | undefined> {
    try {
      return await command();
    } catch (error) {
      this.logger.warn(
        { err: error },
        "Rate limit skipped: Valkey unavailable",
      );
      return undefined;
    }
  }
}

function keyFor(rule: RateLimitRule, subject: string): string {
  // Subjects (emails, addresses) are lower-cased so case changes do not
  // create a fresh allowance.
  return `${KEY_PREFIX}:${rule.name}:${subject.toLowerCase()}`;
}

function rateLimited(rule: RateLimitRule): DomainError {
  return new DomainError("RATE_LIMITED", {
    extensions: { retryAfterSeconds: Math.ceil(rule.windowMs / 1000) },
  });
}
