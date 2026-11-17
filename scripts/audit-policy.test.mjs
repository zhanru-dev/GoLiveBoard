import { describe, expect, it } from "vitest";

import { advisoriesIn, judge } from "./audit-policy.mjs";

const advisory = (name, id, severity = "high") => ({
  source: 1,
  name,
  title: `A problem in ${name}`,
  url: `https://github.com/advisories/${id}`,
  severity,
});

const report = {
  vulnerabilities: {
    picomatch: { via: [advisory("picomatch", "GHSA-aaaa-bbbb-cccc")] },
    // Packages that only depend on it name it, not the advisory.
    vite: { via: ["picomatch", "tinyglobby"] },
    tiny: { via: [advisory("tiny", "GHSA-low0-0000-0000", "low")] },
  },
};

const allow = (id, expires = "2026-12-17", changes = {}) => ({
  advisory: id,
  package: "picomatch",
  severity: "high",
  reason: "Build tooling only",
  reviewed: "2026-11-17",
  expires,
  ...changes,
});

describe("the dependency audit's rule", () => {
  it("names each advisory of moderate severity or above once", () => {
    expect(advisoriesIn(report).map(({ id }) => id)).toEqual([
      "GHSA-aaaa-bbbb-cccc",
    ]);
  });

  it("fails on an advisory nobody allowed", () => {
    expect(judge(report, [], "2026-11-17").problems).toEqual([
      "GHSA-aaaa-bbbb-cccc (high, picomatch): A problem in picomatch",
    ]);
  });

  it("passes an allowed advisory until its allowance expires", () => {
    const allowlist = [allow("GHSA-aaaa-bbbb-cccc")];

    expect(judge(report, allowlist, "2026-12-17").problems).toEqual([]);
    expect(judge(report, allowlist, "2026-12-18").problems).toEqual([
      "GHSA-aaaa-bbbb-cccc is allowed until 2026-12-17 only: review it again",
    ]);
  });

  it("fails on an allowance for an advisory no longer reported, so it is removed", () => {
    expect(
      judge(
        { vulnerabilities: {} },
        [allow("GHSA-aaaa-bbbb-cccc")],
        "2026-11-17",
      ).problems,
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc is no longer reported: remove it from audit-allowlist.json",
    ]);
  });

  it("refuses an allowance longer than 30 days after its review, or reviewed in the future", () => {
    expect(
      judge(report, [allow("GHSA-aaaa-bbbb-cccc", "2026-12-18")], "2026-11-17")
        .problems,
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc is allowed for more than 30 days after its review",
    ]);
    expect(
      judge(
        report,
        [
          allow("GHSA-aaaa-bbbb-cccc", "2026-12-17", {
            reviewed: "2026-11-20",
          }),
        ],
        "2026-11-17",
      ).problems,
    ).toEqual(["GHSA-aaaa-bbbb-cccc was reviewed on 2026-11-20, after today"]);
  });

  it("refuses an allowance without a severity or a reason", () => {
    expect(
      judge(
        report,
        [allow("GHSA-aaaa-bbbb-cccc", "2026-12-17", { severity: undefined })],
        "2026-11-17",
      ).problems,
    ).toEqual(['GHSA-aaaa-bbbb-cccc needs the "severity" it was reviewed at']);
    expect(
      judge(
        report,
        [allow("GHSA-aaaa-bbbb-cccc", "2026-12-17", { reason: " " })],
        "2026-11-17",
      ).problems,
    ).toEqual(["GHSA-aaaa-bbbb-cccc needs a reason"]);
  });

  it("fails when an allowed advisory becomes more severe than it was reviewed at", () => {
    expect(
      judge(
        report,
        [allow("GHSA-aaaa-bbbb-cccc", "2026-12-17", { severity: "moderate" })],
        "2026-11-17",
      ).problems,
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc is now high, reviewed as moderate: review it again",
    ]);
  });

  it("allows only the advisory listed, not another in the same package", () => {
    const two = {
      vulnerabilities: {
        picomatch: {
          via: [
            advisory("picomatch", "GHSA-aaaa-bbbb-cccc"),
            advisory("picomatch", "GHSA-dddd-eeee-ffff", "moderate"),
          ],
        },
      },
    };

    expect(
      judge(two, [allow("GHSA-aaaa-bbbb-cccc")], "2026-11-17").problems,
    ).toEqual([
      "GHSA-dddd-eeee-ffff (moderate, picomatch): A problem in picomatch",
    ]);
  });
});
