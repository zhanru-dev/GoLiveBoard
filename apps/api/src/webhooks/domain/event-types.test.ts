import type { EventStatus } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import { webhookTypeForTransition } from "./event-types.js";

describe("webhookTypeForTransition (docs/04, section 6.2)", () => {
  it("sends a webhook for READY, LIVE, COMPLETED and CANCELLED only", () => {
    const all: EventStatus[] = [
      "DRAFT",
      "CONFIGURING",
      "READY",
      "LIVE",
      "COMPLETED",
      "ARCHIVED",
      "CANCELLED",
    ];

    expect(all.map(webhookTypeForTransition)).toEqual([
      undefined,
      undefined,
      "event.ready",
      "event.live",
      "event.completed",
      undefined,
      "event.cancelled",
    ]);
  });
});
