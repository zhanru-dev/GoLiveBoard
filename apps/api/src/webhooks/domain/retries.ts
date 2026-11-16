/** Attempts in all, the first included (docs/04, section 6.1). */
export const MAX_ATTEMPTS = 5;

/**
 * How long after the first attempt each retry comes: about 1 minute, 5
 * minutes, 30 minutes and 2 hours. Each wait is the gap to the next.
 */
const RETRY_AT_MS = [60_000, 5 * 60_000, 30 * 60_000, 120 * 60_000];

/** Retries spread by up to this share of their wait, either way. */
export const JITTER = 0.1;

/**
 * When to try a delivery again after `attemptsMade` attempts, or null when
 * none are left. `random` is in [0, 1).
 */
export function nextAttemptAt(
  attemptsMade: number,
  lastAttemptAt: Date,
  random: () => number = Math.random,
): Date | null {
  if (attemptsMade >= MAX_ATTEMPTS || attemptsMade < 1) {
    return null;
  }
  const previous =
    attemptsMade === 1 ? 0 : (RETRY_AT_MS[attemptsMade - 2] ?? 0);
  const target = RETRY_AT_MS[attemptsMade - 1] ?? 0;
  const gap = target - previous;
  const jitter = gap * JITTER * (random() * 2 - 1);
  return new Date(lastAttemptAt.getTime() + Math.round(gap + jitter));
}

/** docs/04 section 6.1: any 2xx answer is a success. */
export function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}
