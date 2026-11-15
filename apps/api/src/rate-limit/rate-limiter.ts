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
  /**
   * Refuse with `503` when Valkey cannot count, instead of skipping the
   * limit. For limits that bound what is stored rather than slow down
   * guessing (the demo's write budget).
   */
  readonly failClosed?: boolean;
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
  /** Registrations for events, from one address (FR-AD-3). */
  registrationsPerIp: {
    name: "registration:ip",
    limit: 10,
    windowMs: HOUR_MS,
  },
  /** Verification links used from one address; guessing is hopeless anyway. */
  attendeeVerificationsPerIp: {
    name: "attendee-verification:ip",
    limit: 30,
    windowMs: HOUR_MS,
  },
  /** Changes to the demo workspace (DemoWriteBudgetGuard): from one address... */
  demoWritesPerIp: {
    name: "demo-writes:ip",
    limit: 300,
    windowMs: HOUR_MS,
    failClosed: true,
  },
  /** ...and from everyone together, so the demo stays small between resets. */
  demoWritesPerWorkspace: {
    name: "demo-writes:workspace",
    limit: 3_000,
    windowMs: HOUR_MS,
    failClosed: true,
  },
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
  /**
   * Real-time connections opened from one address. Clients reconnect with a
   * backoff (1 s doubling to 30 s), so a person needs a few per minute.
   */
  realtimeConnectionsPerIp: {
    name: "realtime-connections:ip",
    limit: 60,
    windowMs: MINUTE_MS,
  },
  /** Chat messages from one author, whatever connection they use (FR-RN-2). */
  chatMessagesPerAuthor: {
    name: "chat:author",
    limit: 20,
    windowMs: MINUTE_MS,
  },
  /** Questions from one author (FR-RN-4). */
  questionsPerAuthor: {
    name: "questions:author",
    limit: 5,
    windowMs: MINUTE_MS,
  },
  /** Votes and unvotes from one attendee. */
  votesPerAttendee: {
    name: "votes:attendee",
    limit: 60,
    windowMs: MINUTE_MS,
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
 * out, and the readiness check reports the outage anyway. A rule that bounds
 * what is stored fails closed instead (`failClosed`).
 */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(VALKEY_CLIENT) private readonly valkey: Redis,
    @InjectPinoLogger(RateLimiter.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Counts one event; true while the key is within its limit. When Valkey
   * cannot count, true (fail open), unless the rule fails closed.
   *
   * @throws DomainError `SERVICE_UNAVAILABLE` when Valkey cannot count and
   * the rule fails closed
   */
  async consume(rule: RateLimitRule, subject: string): Promise<boolean> {
    const count = await this.increment(rule, subject);
    if (count === undefined) {
      if (rule.failClosed === true) {
        throw new DomainError("SERVICE_UNAVAILABLE");
      }
      return true;
    }
    return count <= rule.limit;
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
