import { describe, expect, it } from "vitest";

import { demoGuideSteps, type DemoProgress } from "./demo-guide-steps";

const SEED: DemoProgress = {
  events: [
    { id: "draft", slug: "all-hands", status: "DRAFT" },
    { id: "prep", slug: "autumn", status: "CONFIGURING" },
    { id: "past", slug: "conference", status: "COMPLETED" },
  ],
  openedLaunchControl: false,
  tickedTask: false,
  registered: false,
  triaged: false,
  openedReport: false,
};

describe("demoGuideSteps", () => {
  it("points each step at the seeded event it needs", () => {
    const hrefs = Object.fromEntries(
      demoGuideSteps(SEED).map((s) => [s.id, s.href]),
    );

    expect(hrefs).toEqual({
      "launch-control": "/events/prep",
      task: "/events/prep#runbook",
      register: "/e/autumn",
      triage: "/events/prep#live-interaction",
      report: "/events/past/report",
    });
  });

  it("ticks each step from what this browser has done", () => {
    const steps = demoGuideSteps({
      ...SEED,
      openedLaunchControl: true,
      tickedTask: true,
      registered: true,
      triaged: true,
      openedReport: true,
    });

    expect(steps.every((step) => step.done)).toBe(true);
  });

  it("falls back to the events list when the seed is not there", () => {
    expect(
      demoGuideSteps({ ...SEED, events: [] }).every(
        (s) => s.href === "/events",
      ),
    ).toBe(true);
  });
});
