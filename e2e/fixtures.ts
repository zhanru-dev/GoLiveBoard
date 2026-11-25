import { test as base } from "@playwright/test";

import { resetRateLimits } from "./rate-limits.js";

/**
 * Playwright's `test`, with every test starting from fresh rate-limit
 * windows: what one test spends never makes another fail.
 */
export const test = base.extend<{ freshRateLimits: undefined }>({
  freshRateLimits: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs the pattern
    async ({}, use) => {
      resetRateLimits();
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

/**
 * How long landing on the events list may take after signing up or in:
 * the API hashes the password (argon2, twice on sign-up) and the router
 * fetches the page, which together can pass the default 5 seconds on a
 * busy machine.
 */
export const SIGNED_IN_MS = 15_000;
