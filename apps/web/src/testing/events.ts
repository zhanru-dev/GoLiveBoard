import type { EventDetail, Readiness } from "@goliveboard/contracts";

import { OWNER } from "./render";

export const EVENT_ID = "0195f0a0-0000-7000-8000-0000000000e1";

/** An event as the API returns it; override what a test cares about. */
export function anEvent(changes: Partial<EventDetail> = {}): EventDetail {
  return {
    id: EVENT_ID,
    slug: "product-launch-k3x9q2mz7a",
    title: "Product launch",
    status: "CONFIGURING",
    startsAt: "2026-12-01T18:00:00.000Z",
    endsAt: "2026-12-01T19:30:00.000Z",
    timeZone: "Europe/London",
    owner: null,
    description: "The autumn release.",
    streamUrl: null,
    allowedTransitions: ["READY", "CANCELLED"],
    expectedAttendance: null,
    questionsPreModerated: false,
    version: 3,
    createdAt: "2026-11-13T09:00:00.000Z",
    updatedAt: "2026-11-13T09:00:00.000Z",
    ...changes,
  };
}

export function aReadiness(changes: Partial<Readiness> = {}): Readiness {
  return {
    ruleVersion: 1,
    assessedAt: "2026-11-13T09:00:00.000Z",
    score: 35,
    criteria: [
      {
        criterion: "ACCESS_POLICY",
        score: 0,
        maxScore: 20,
        blocking: true,
        evidence: "No access policy has been set.",
      },
      {
        criterion: "CRITICAL_TASKS_DONE",
        score: 25,
        maxScore: 25,
        blocking: false,
        evidence: "The runbook has no critical tasks.",
      },
    ],
    blockers: [
      {
        criterion: "ACCESS_POLICY",
        evidence: "No access policy has been set.",
      },
    ],
    nextActions: [
      {
        criterion: "ACCESS_POLICY",
        action: "Choose who can register.",
        gain: 20,
        unblocks: true,
        section: "ACCESS_POLICY",
      },
    ],
    ...changes,
  };
}

export const ANALYST = {
  ...OWNER,
  activeWorkspace: { ...OWNER.activeWorkspace, role: "ANALYST" as const },
};

export function problem(status: number, code: string, extra: object = {}) {
  return {
    type: "about:blank",
    title: code,
    status,
    code,
    requestId: "req-1",
    ...extra,
  };
}
