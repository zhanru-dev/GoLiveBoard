import type { ReadinessCriterion } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import {
  assessReadiness,
  CURRENT_RULE_VERSION,
  type ReadinessInput,
  STREAM_CHECK_FRESH_MS,
} from "./readiness.js";

const NOW = new Date("2026-12-01T17:30:00Z");
const MINUTE = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Task = ReadinessInput["tasks"][number];
const task = (status: Task["status"], isCritical = false): Task => ({
  status,
  isCritical,
});

/**
 * Builds readiness input, starting from an event that is fully ready:
 * `aReadinessInput().withoutAccessPolicy().build()`.
 */
function aReadinessInput() {
  let input: ReadinessInput = {
    now: NOW,
    accessPolicy: { mode: "PUBLIC" },
    streamUrl: "https://stream.example.com/live/index.m3u8",
    latestStreamCheck: {
      ok: true,
      checkedAt: ago(MINUTE),
      httpStatus: 200,
      latencyMs: 140,
      failure: null,
    },
    tasks: [task("DONE", true), task("DONE")],
    holdingSlateReady: true,
    hasOwner: true,
    hasDescription: true,
  };
  const builder = {
    with(changes: Partial<ReadinessInput>) {
      input = { ...input, ...changes };
      return builder;
    },
    withoutAccessPolicy: () => builder.with({ accessPolicy: null }),
    withStreamCheck: (
      check: Partial<NonNullable<ReadinessInput["latestStreamCheck"]>>,
    ) =>
      builder.with({
        latestStreamCheck: {
          ok: true,
          checkedAt: ago(MINUTE),
          httpStatus: 200,
          latencyMs: 140,
          failure: null,
          ...check,
        },
      }),
    withTasks: (...tasks: Task[]) => builder.with({ tasks }),
    build: () => input,
  };
  return builder;
}

function criterion(input: ReadinessInput, name: ReadinessCriterion) {
  const result = assessReadiness(input).criteria.find(
    (candidate) => candidate.criterion === name,
  );
  if (result === undefined) {
    throw new Error(`No criterion ${name}`);
  }
  return result;
}

describe("assessReadiness, rule version 1", () => {
  it("scores a fully prepared event 100 with no blockers or actions", () => {
    const assessment = assessReadiness(aReadinessInput().build());

    expect(assessment).toMatchObject({
      ruleVersion: 1,
      score: 100,
      blockers: [],
      nextActions: [],
    });
    expect(assessment.criteria.map((c) => c.criterion)).toEqual([
      "ACCESS_POLICY",
      "STREAM_REACHABLE",
      "CRITICAL_TASKS_DONE",
      "HOLDING_SLATE",
      "ALL_TASKS_DONE",
      "OWNER_AND_DESCRIPTION",
    ]);
  });

  it("has maximum scores that add up to 100", () => {
    const { criteria } = assessReadiness(aReadinessInput().build());
    expect(criteria.reduce((sum, c) => sum + c.maxScore, 0)).toBe(100);
  });

  it("uses rule version 1 by default and refuses unknown versions", () => {
    expect(CURRENT_RULE_VERSION).toBe(1);
    expect(() => assessReadiness(aReadinessInput().build(), 99)).toThrow(
      "Unknown readiness rule version 99",
    );
  });

  it("gives the same result for the same input", () => {
    const input = aReadinessInput().withoutAccessPolicy().build();
    expect(assessReadiness(input)).toEqual(assessReadiness(input));
  });

  describe("ACCESS_POLICY (20 points, hard blocker)", () => {
    it("blocks when no policy is set", () => {
      expect(
        criterion(
          aReadinessInput().withoutAccessPolicy().build(),
          "ACCESS_POLICY",
        ),
      ).toEqual({
        criterion: "ACCESS_POLICY",
        score: 0,
        maxScore: 20,
        blocking: true,
        evidence: "No access policy has been set.",
      });
    });

    it.each([
      ["PUBLIC", "anyone can register"],
      ["EMAIL_DOMAIN", "limited to email domains"],
      ["INVITE_ONLY", "invitation only"],
    ] as const)("names the %s mode in the evidence", (mode, words) => {
      const result = criterion(
        aReadinessInput().with({ accessPolicy: { mode } }).build(),
        "ACCESS_POLICY",
      );
      expect(result).toMatchObject({ score: 20, blocking: false });
      expect(result.evidence).toBe(`Access policy set: ${words}.`);
    });
  });

  describe("STREAM_REACHABLE (25 points, hard blocker)", () => {
    it("passes with a successful check less than 5 minutes old", () => {
      expect(
        criterion(aReadinessInput().build(), "STREAM_REACHABLE"),
      ).toMatchObject({
        score: 25,
        blocking: false,
        evidence:
          "The last stream check succeeded 1 minute ago (HTTP 200, 140 ms).",
      });
    });

    it("still passes at exactly 5 minutes", () => {
      const input = aReadinessInput()
        .withStreamCheck({ checkedAt: ago(STREAM_CHECK_FRESH_MS) })
        .build();
      expect(criterion(input, "STREAM_REACHABLE").blocking).toBe(false);
    });

    it.each([
      [
        "no stream URL",
        aReadinessInput().with({ streamUrl: null, latestStreamCheck: null }),
        "No stream URL has been set.",
      ],
      [
        "a URL that was never checked",
        aReadinessInput().with({ latestStreamCheck: null }),
        "The stream has not been checked yet.",
      ],
      [
        "a failed check with a status",
        aReadinessInput().withStreamCheck({ ok: false, httpStatus: 404 }),
        "The last stream check failed 1 minute ago (HTTP 404).",
      ],
      [
        "a failed check without a response",
        aReadinessInput().withStreamCheck({
          ok: false,
          httpStatus: null,
          failure: "timed out",
        }),
        "The last stream check failed 1 minute ago (timed out).",
      ],
      [
        "a failed check without a reason",
        aReadinessInput().withStreamCheck({ ok: false, httpStatus: null }),
        "The last stream check failed 1 minute ago (no response).",
      ],
      [
        "a successful check that is too old",
        aReadinessInput().withStreamCheck({
          checkedAt: ago(STREAM_CHECK_FRESH_MS + 1),
        }),
        "The last successful stream check was 5 minutes ago; it must be less than 5 minutes old.",
      ],
    ])("blocks with %s", (_label, builder, evidence) => {
      expect(criterion(builder.build(), "STREAM_REACHABLE")).toEqual({
        criterion: "STREAM_REACHABLE",
        score: 0,
        maxScore: 25,
        blocking: true,
        evidence,
      });
    });
  });

  describe("CRITICAL_TASKS_DONE (25 points, hard blocker)", () => {
    it("blocks while any critical task is open", () => {
      const input = aReadinessInput()
        .withTasks(task("DONE", true), task("TODO", true), task("TODO", true))
        .build();
      expect(criterion(input, "CRITICAL_TASKS_DONE")).toMatchObject({
        score: 0,
        blocking: true,
        evidence: "2 of 3 critical tasks are still open.",
      });
    });

    it("ignores open ordinary tasks", () => {
      const input = aReadinessInput()
        .withTasks(task("DONE", true), task("TODO"))
        .build();
      expect(criterion(input, "CRITICAL_TASKS_DONE")).toMatchObject({
        score: 25,
        blocking: false,
        evidence: "All 1 critical tasks are done.",
      });
    });

    it("passes when the runbook has no critical tasks", () => {
      const input = aReadinessInput().withTasks(task("TODO")).build();
      expect(criterion(input, "CRITICAL_TASKS_DONE")).toMatchObject({
        score: 25,
        evidence: "The runbook has no critical tasks.",
      });
    });
  });

  describe("HOLDING_SLATE (10 points, hard blocker)", () => {
    it("blocks when no slate is ready", () => {
      expect(
        criterion(
          aReadinessInput().with({ holdingSlateReady: false }).build(),
          "HOLDING_SLATE",
        ),
      ).toMatchObject({ score: 0, blocking: true });
    });
  });

  describe("ALL_TASKS_DONE (10 points)", () => {
    it.each([
      [[], 0, "The runbook has no tasks."],
      [[task("TODO"), task("TODO")], 0, "0 of 2 tasks are done."],
      [[task("DONE"), task("TODO"), task("TODO")], 3, "1 of 3 tasks are done."],
      [[task("DONE"), task("DONE"), task("TODO")], 6, "2 of 3 tasks are done."],
      [[task("DONE"), task("DONE")], 10, "2 of 2 tasks are done."],
    ])("scores %j as %s", (tasks, score, evidence) => {
      expect(
        criterion(
          aReadinessInput()
            .withTasks(...tasks)
            .build(),
          "ALL_TASKS_DONE",
        ),
      ).toEqual({
        criterion: "ALL_TASKS_DONE",
        score,
        maxScore: 10,
        blocking: false,
        evidence,
      });
    });
  });

  describe("OWNER_AND_DESCRIPTION (10 points)", () => {
    it.each([
      [true, true, 10, "Owner assigned; description written."],
      [false, true, 5, "No owner assigned; description written."],
      [true, false, 5, "Owner assigned; no description."],
      [false, false, 0, "No owner assigned; no description."],
    ])(
      "owner %s, description %s scores %s",
      (hasOwner, hasDescription, score, evidence) => {
        expect(
          criterion(
            aReadinessInput().with({ hasOwner, hasDescription }).build(),
            "OWNER_AND_DESCRIPTION",
          ),
        ).toMatchObject({ score, blocking: false, evidence });
      },
    );
  });

  describe("blockers and next actions", () => {
    const empty = aReadinessInput()
      .with({
        accessPolicy: null,
        streamUrl: null,
        latestStreamCheck: null,
        tasks: [task("TODO", true), task("TODO")],
        holdingSlateReady: false,
        hasOwner: false,
        hasDescription: false,
      })
      .build();

    it("lists every hard blocker with its evidence", () => {
      expect(assessReadiness(empty).blockers).toEqual([
        {
          criterion: "ACCESS_POLICY",
          evidence: "No access policy has been set.",
        },
        {
          criterion: "STREAM_REACHABLE",
          evidence: "No stream URL has been set.",
        },
        {
          criterion: "CRITICAL_TASKS_DONE",
          evidence: "1 of 1 critical tasks are still open.",
        },
        {
          criterion: "HOLDING_SLATE",
          evidence: "No holding slate has been uploaded.",
        },
      ]);
      expect(assessReadiness(empty).score).toBe(0);
    });

    it("orders actions: blockers first, then by points gained, then rule order", () => {
      expect(assessReadiness(empty).nextActions).toEqual([
        {
          criterion: "STREAM_REACHABLE",
          action: "Set the stream URL.",
          gain: 25,
          unblocks: true,
          section: "STREAM",
        },
        {
          criterion: "CRITICAL_TASKS_DONE",
          action: "Complete the open critical tasks.",
          gain: 25,
          unblocks: true,
          section: "RUNBOOK",
        },
        {
          criterion: "ACCESS_POLICY",
          action: "Choose who can register.",
          gain: 20,
          unblocks: true,
          section: "ACCESS_POLICY",
        },
        {
          criterion: "HOLDING_SLATE",
          action: "Upload a holding slate image.",
          gain: 10,
          unblocks: true,
          section: "HOLDING_SLATE",
        },
        {
          criterion: "ALL_TASKS_DONE",
          action: "Complete the remaining tasks.",
          gain: 10,
          unblocks: false,
          section: "RUNBOOK",
        },
        {
          criterion: "OWNER_AND_DESCRIPTION",
          action: "Assign an owner and write a description.",
          gain: 10,
          unblocks: false,
          section: "DETAILS",
        },
      ]);
    });

    it("suggests the missing half of owner and description", () => {
      const actions = assessReadiness(
        aReadinessInput()
          .with({ hasOwner: true, hasDescription: false })
          .build(),
      ).nextActions;
      expect(actions).toEqual([
        expect.objectContaining({ action: "Write a description.", gain: 5 }),
      ]);
    });

    it("suggests adding tasks to an empty runbook", () => {
      expect(
        assessReadiness(aReadinessInput().withTasks().build()).nextActions,
      ).toEqual([
        expect.objectContaining({
          action: "Add this event's tasks to the runbook.",
          gain: 10,
        }),
      ]);
    });

    it("suggests a fresh check for a stale or missing check", () => {
      const stale = aReadinessInput()
        .withStreamCheck({ checkedAt: ago(10 * MINUTE) })
        .build();
      expect(assessReadiness(stale).nextActions[0]?.action).toBe(
        "Check the stream now.",
      );
    });
  });
});
