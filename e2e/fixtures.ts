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
