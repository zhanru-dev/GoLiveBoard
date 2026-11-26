import type { EventStatus } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import { isInteractionOpen, isInteractionReadable } from "./interaction.js";

const ALL: EventStatus[] = [
  "DRAFT",
  "CONFIGURING",
  "READY",
  "LIVE",
  "COMPLETED",
  "ARCHIVED",
  "CANCELLED",
];

describe("interaction windows", () => {
  it("takes messages from preparation until the event ends", () => {
    expect(ALL.filter(isInteractionOpen)).toEqual([
      "CONFIGURING",
      "READY",
      "LIVE",
    ]);
  });

  it("can be read after the event too, until it is archived", () => {
    expect(ALL.filter(isInteractionReadable)).toEqual([
      "CONFIGURING",
      "READY",
      "LIVE",
      "COMPLETED",
    ]);
  });
});
