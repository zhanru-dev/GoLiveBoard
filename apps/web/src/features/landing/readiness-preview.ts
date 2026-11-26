/**
 * The example on the home page, "Autumn product launch", scored exactly as
 * readiness rule version 1 scores a real event (docs/03, section 3): an
 * interviewer will open the demo and compare. 12 runbook tasks, 9 done,
 * one critical task open; ticking it leaves 10 of 12 done.
 */
export const PREVIEW_TASKS = 12;

export interface PreviewCriterion {
  readonly name: string;
  readonly detail: string;
  readonly score: number;
  readonly maxScore: number;
  /** Blocks READY and LIVE while it fails. */
  readonly blocking: boolean;
}

export interface PreviewReadiness {
  readonly criteria: readonly PreviewCriterion[];
  readonly score: number;
  readonly blockers: number;
}

export function previewReadiness(criticalDone: boolean): PreviewReadiness {
  const tasksDone = criticalDone ? 10 : 9;
  const criteria: PreviewCriterion[] = [
    {
      name: "Access policy",
      detail: "Invite only",
      score: 20,
      maxScore: 20,
      blocking: false,
    },
    {
      name: "Stream reachable",
      detail: "checked 12 s ago",
      score: 25,
      maxScore: 25,
      blocking: false,
    },
    {
      name: "Critical tasks",
      detail: criticalDone ? "done" : "1 open",
      // All or nothing, and a hard blocker while any is open.
      score: criticalDone ? 25 : 0,
      maxScore: 25,
      blocking: !criticalDone,
    },
    {
      name: "Holding slate",
      detail: "uploaded",
      score: 10,
      maxScore: 10,
      blocking: false,
    },
    {
      name: "All tasks done",
      detail: `${String(tasksDone)} of ${String(PREVIEW_TASKS)}`,
      // In proportion, rounded down.
      score: Math.floor((10 * tasksDone) / PREVIEW_TASKS),
      maxScore: 10,
      blocking: false,
    },
    {
      name: "Owner and description",
      detail: "both set",
      score: 10,
      maxScore: 10,
      blocking: false,
    },
  ];
  return {
    criteria,
    score: criteria.reduce((sum, criterion) => sum + criterion.score, 0),
    blockers: criteria.filter((criterion) => criterion.blocking).length,
  };
}
