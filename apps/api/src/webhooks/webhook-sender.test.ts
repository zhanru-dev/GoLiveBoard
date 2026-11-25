import { describe, expect, it } from "vitest";

import { CLAIM_LEASE_MS, DELIVERY_TIMEOUT_MS } from "./webhook-sender.js";

describe("the sender's lease", () => {
  it("outlasts a send, with room to record it", () => {
    // Shorter, and a second worker would send an attempt still under way.
    expect(CLAIM_LEASE_MS).toBeGreaterThanOrEqual(2 * DELIVERY_TIMEOUT_MS);
  });
});
