import { EventStatus } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  isReadOnly,
  planTransition,
  type TransitionGate,
} from "./lifecycle.js";

type Move = readonly [EventStatus, EventStatus, TransitionGate];

/** docs/03-domain-and-data-model.md, section 2, written out by hand. */
const LEGAL: readonly Move[] = [
  ["DRAFT", "CONFIGURING", "NONE"],
  ["DRAFT", "CANCELLED", "NONE"],
  ["CONFIGURING", "READY", "NO_HARD_BLOCKERS"],
  ["CONFIGURING", "CANCELLED", "NONE"],
  ["READY", "CONFIGURING", "NONE"],
  ["READY", "LIVE", "NO_HARD_BLOCKERS"],
  ["READY", "CANCELLED", "NONE"],
  ["LIVE", "COMPLETED", "NONE"],
  ["COMPLETED", "ARCHIVED", "NONE"],
  ["CANCELLED", "ARCHIVED", "NONE"],
];

const isLegal = (from: EventStatus, to: EventStatus) =>
  LEGAL.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);

const ILLEGAL = EventStatus.options.flatMap((from) =>
  EventStatus.options
    .filter((to) => !isLegal(from, to))
    .map((to) => [from, to] as const),
);

describe("planTransition", () => {
  it.each(LEGAL)("allows %s → %s with gate %s", (from, to, gate) => {
    expect(planTransition(from, to)).toEqual({ allowed: true, gate });
  });

  it.each(ILLEGAL)("rejects %s → %s", (from, to) => {
    expect(planTransition(from, to)).toEqual({ allowed: false });
  });

  it("covers every pair of statuses", () => {
    const statuses = EventStatus.options.length;
    expect(LEGAL.length + ILLEGAL.length).toBe(statuses * statuses);
  });

  it.each(["LIVE", "COMPLETED", "ARCHIVED"] as const)(
    "never allows cancelling from %s, which is at or after LIVE",
    (from) => {
      expect(planTransition(from, "CANCELLED").allowed).toBe(false);
    },
  );
});

describe("allowedTransitions", () => {
  it("lists the moves from READY", () => {
    expect(allowedTransitions("READY")).toEqual([
      "CONFIGURING",
      "LIVE",
      "CANCELLED",
    ]);
  });

  it("lists nothing from ARCHIVED", () => {
    expect(allowedTransitions("ARCHIVED")).toEqual([]);
  });
});

describe("isReadOnly", () => {
  it.each(EventStatus.options)("decides whether %s is read-only", (status) => {
    expect(isReadOnly(status)).toBe(status === "ARCHIVED");
  });
});
