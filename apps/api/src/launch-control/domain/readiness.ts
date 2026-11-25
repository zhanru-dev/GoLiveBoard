import type {
  AccessMode,
  Blocker,
  CriterionResult,
  NextAction,
  ReadinessCriterion,
  ReadinessSection,
  TaskStatus,
} from "@opspilot/contracts";

import { timeAgo } from "./relative-time.js";

/** The rule version new assessments use; stored with each assessment. */
export const CURRENT_RULE_VERSION = 1;

/** A stream check older than this no longer proves the stream works. */
export const STREAM_CHECK_FRESH_MS = 5 * 60 * 1000;

/**
 * Everything readiness depends on. The caller loads it (under the event's row
 * lock when it gates a transition); readiness itself reads no database and no
 * clock, so the same input always gives the same result (FR-LC-2).
 */
export interface ReadinessInput {
  readonly now: Date;
  readonly accessPolicy: { readonly mode: AccessMode } | null;
  readonly streamUrl: string | null;
  readonly latestStreamCheck: {
    readonly ok: boolean;
    readonly checkedAt: Date;
    readonly httpStatus: number | null;
    readonly latencyMs: number;
    readonly failure: string | null;
  } | null;
  readonly tasks: readonly {
    readonly isCritical: boolean;
    readonly status: TaskStatus;
  }[];
  readonly holdingSlateReady: boolean;
  readonly hasOwner: boolean;
  readonly hasDescription: boolean;
}

export interface ReadinessAssessment {
  readonly ruleVersion: number;
  /** 0 to 100: the sum of the criteria's scores. */
  readonly score: number;
  readonly criteria: CriterionResult[];
  readonly blockers: Blocker[];
  readonly nextActions: NextAction[];
}

/** What one rule concludes, plus how to improve it when it is not full. */
interface RuleOutcome {
  readonly result: CriterionResult;
  readonly fix?: {
    readonly action: string;
    readonly section: ReadinessSection;
  };
}

type Rule = (input: ReadinessInput) => RuleOutcome;

function outcome(
  criterion: ReadinessCriterion,
  maxScore: number,
  score: number,
  evidence: string,
  options: {
    blocking?: boolean;
    fix?: { action: string; section: ReadinessSection };
  } = {},
): RuleOutcome {
  return {
    result: {
      criterion,
      score,
      maxScore,
      blocking: options.blocking ?? false,
      evidence,
    },
    ...(score < maxScore && options.fix !== undefined && { fix: options.fix }),
  };
}

const ACCESS_LABELS: Readonly<Record<AccessMode, string>> = {
  PUBLIC: "anyone can register",
  EMAIL_DOMAIN: "limited to email domains",
  INVITE_ONLY: "invitation only",
};

/** 20 points; hard blocker when missing. */
const accessPolicyRule: Rule = ({ accessPolicy }) =>
  accessPolicy === null
    ? outcome("ACCESS_POLICY", 20, 0, "No access policy has been set.", {
        blocking: true,
        fix: { action: "Choose who can register.", section: "ACCESS_POLICY" },
      })
    : outcome(
        "ACCESS_POLICY",
        20,
        20,
        `Access policy set: ${ACCESS_LABELS[accessPolicy.mode]}.`,
      );

/** 25 points; hard blocker unless the latest check succeeded within 5 minutes. */
const streamReachableRule: Rule = ({ streamUrl, latestStreamCheck, now }) => {
  const fail = (evidence: string, action: string) =>
    outcome("STREAM_REACHABLE", 25, 0, evidence, {
      blocking: true,
      fix: { action, section: "STREAM" },
    });
  if (streamUrl === null) {
    return fail("No stream URL has been set.", "Set the stream URL.");
  }
  if (latestStreamCheck === null) {
    return fail(
      "The stream has not been checked yet.",
      "Check the stream now.",
    );
  }
  const ago = timeAgo(latestStreamCheck.checkedAt, now);
  if (!latestStreamCheck.ok) {
    const reason =
      latestStreamCheck.httpStatus === null
        ? (latestStreamCheck.failure ?? "no response")
        : `HTTP ${String(latestStreamCheck.httpStatus)}`;
    return fail(
      `The last stream check failed ${ago} (${reason}).`,
      "Fix the stream at your provider or correct the stream URL.",
    );
  }
  const age = now.getTime() - latestStreamCheck.checkedAt.getTime();
  if (age > STREAM_CHECK_FRESH_MS) {
    return fail(
      `The last successful stream check was ${ago}; it must be less than 5 minutes old.`,
      "Check the stream now.",
    );
  }
  return outcome(
    "STREAM_REACHABLE",
    25,
    25,
    `The last stream check succeeded ${ago} (HTTP ${String(latestStreamCheck.httpStatus)}, ${String(latestStreamCheck.latencyMs)} ms).`,
  );
};

/** 25 points; hard blocker while any critical task is open. */
const criticalTasksRule: Rule = ({ tasks }) => {
  const critical = tasks.filter((task) => task.isCritical);
  const open = critical.filter((task) => task.status === "TODO").length;
  if (critical.length === 0) {
    return outcome(
      "CRITICAL_TASKS_DONE",
      25,
      25,
      "The runbook has no critical tasks.",
    );
  }
  if (open > 0) {
    return outcome(
      "CRITICAL_TASKS_DONE",
      25,
      0,
      `${String(open)} of ${String(critical.length)} critical tasks are still open.`,
      {
        blocking: true,
        fix: {
          action: "Complete the open critical tasks.",
          section: "RUNBOOK",
        },
      },
    );
  }
  return outcome(
    "CRITICAL_TASKS_DONE",
    25,
    25,
    `All ${String(critical.length)} critical tasks are done.`,
  );
};

/** 10 points; hard blocker when missing. */
const holdingSlateRule: Rule = ({ holdingSlateReady }) =>
  holdingSlateReady
    ? outcome("HOLDING_SLATE", 10, 10, "A holding slate has been uploaded.")
    : outcome("HOLDING_SLATE", 10, 0, "No holding slate has been uploaded.", {
        blocking: true,
        fix: {
          action: "Upload a holding slate image.",
          section: "HOLDING_SLATE",
        },
      });

/**
 * 10 points in proportion to completed tasks, rounded down, so the score only
 * reaches 10 when every task is done. An empty runbook scores 0: an event
 * with no plan is not ready, even if nothing blocks it.
 */
const allTasksRule: Rule = ({ tasks }) => {
  if (tasks.length === 0) {
    return outcome("ALL_TASKS_DONE", 10, 0, "The runbook has no tasks.", {
      fix: {
        action: "Add this event's tasks to the runbook.",
        section: "RUNBOOK",
      },
    });
  }
  const done = tasks.filter((task) => task.status === "DONE").length;
  return outcome(
    "ALL_TASKS_DONE",
    10,
    Math.floor((10 * done) / tasks.length),
    `${String(done)} of ${String(tasks.length)} tasks are done.`,
    { fix: { action: "Complete the remaining tasks.", section: "RUNBOOK" } },
  );
};

/** 5 points for an owner and 5 for a description. */
const ownerAndDescriptionRule: Rule = ({ hasOwner, hasDescription }) => {
  const missing = [
    ...(hasOwner ? [] : ["assign an owner"]),
    ...(hasDescription ? [] : ["write a description"]),
  ];
  const evidence = `${hasOwner ? "Owner assigned" : "No owner assigned"}; ${hasDescription ? "description written" : "no description"}.`;
  const action = missing.join(" and ");
  return outcome(
    "OWNER_AND_DESCRIPTION",
    10,
    (hasOwner ? 5 : 0) + (hasDescription ? 5 : 0),
    evidence,
    {
      fix: {
        action: `${action.charAt(0).toUpperCase()}${action.slice(1)}.`,
        section: "DETAILS",
      },
    },
  );
};

/**
 * Rule version 1 (docs/03 section 3), in display order. A rule change adds a
 * new version instead of editing this one, so stored assessments stay
 * explainable.
 */
const RULES_V1: readonly Rule[] = [
  accessPolicyRule,
  streamReachableRule,
  criticalTasksRule,
  holdingSlateRule,
  allTasksRule,
  ownerAndDescriptionRule,
];

const RULES_BY_VERSION: ReadonlyMap<number, readonly Rule[]> = new Map([
  [1, RULES_V1],
]);

/**
 * Next actions, most useful first (FR-LC-4): those that remove a hard
 * blocker, then by points gained, then in rule order (the sort is stable).
 */
function nextActionsFrom(outcomes: readonly RuleOutcome[]): NextAction[] {
  return outcomes
    .flatMap(({ result, fix }) =>
      fix === undefined
        ? []
        : [
            {
              criterion: result.criterion,
              action: fix.action,
              gain: result.maxScore - result.score,
              unblocks: result.blocking,
              section: fix.section,
            },
          ],
    )
    .sort((a, b) => Number(b.unblocks) - Number(a.unblocks) || b.gain - a.gain);
}

/**
 * Assesses an event's readiness (FR-LC-2 to FR-LC-4).
 *
 * @param input - the event's current data, including "now"
 * @param ruleVersion - which rules to apply; defaults to the current version
 * @returns the score out of 100, each criterion with its evidence, the hard
 * blockers that stop `READY` and `LIVE`, and the next actions ordered by
 * impact
 * @throws Error for a rule version that does not exist (a programming error)
 */
export function assessReadiness(
  input: ReadinessInput,
  ruleVersion: number = CURRENT_RULE_VERSION,
): ReadinessAssessment {
  const rules = RULES_BY_VERSION.get(ruleVersion);
  if (rules === undefined) {
    throw new Error(`Unknown readiness rule version ${String(ruleVersion)}`);
  }
  const outcomes = rules.map((rule) => rule(input));
  const criteria = outcomes.map(({ result }) => result);
  return {
    ruleVersion,
    score: criteria.reduce((sum, criterion) => sum + criterion.score, 0),
    criteria,
    blockers: criteria
      .filter((criterion) => criterion.blocking)
      .map(({ criterion, evidence }) => ({ criterion, evidence })),
    nextActions: nextActionsFrom(outcomes),
  };
}
