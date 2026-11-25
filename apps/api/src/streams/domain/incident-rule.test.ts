import { describe, expect, it } from "vitest";

import { incidentChange } from "./incident-rule.js";

const ok = { ok: true };
const failed = { ok: false };

describe("incidentChange (newest check first)", () => {
  it.each([
    ["one failure", [failed], false, "NONE"],
    ["two failures", [failed, failed], false, "OPEN"],
    ["a failure after a success", [failed, ok], false, "NONE"],
    ["two failures with an incident open", [failed, failed], true, "NONE"],
    ["two successes with an incident open", [ok, ok, failed], true, "RESOLVE"],
    ["one success with an incident open", [ok, failed, failed], true, "NONE"],
    ["two successes with nothing open", [ok, ok], false, "NONE"],
    ["no checks", [], false, "NONE"],
  ] as const)("%s → %s", (_label, recent, open, change) => {
    expect(incidentChange(recent, open)).toBe(change);
  });
});
