"use client";

import {
  Readiness,
  type ReadinessCriterion,
  type ReadinessSection,
} from "@goliveboard/contracts";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

import { eventKeys } from "../events/event-keys";
import { LIVE_REFRESH_MS, type LaunchControl } from "./use-launch-control";

const CRITERION_LABELS: Readonly<Record<ReadinessCriterion, string>> = {
  ACCESS_POLICY: "Access policy",
  STREAM_REACHABLE: "Stream reachable",
  CRITICAL_TASKS_DONE: "Critical tasks done",
  HOLDING_SLATE: "Holding slate",
  ALL_TASKS_DONE: "All tasks done",
  OWNER_AND_DESCRIPTION: "Owner and description",
};

/** The anchor of the section where a criterion is fixed. */
export const SECTION_IDS: Readonly<Record<ReadinessSection, string>> = {
  ACCESS_POLICY: "access-policy",
  STREAM: "stream",
  RUNBOOK: "runbook",
  HOLDING_SLATE: "holding-slate",
  DETAILS: "details",
};

/** FR-LC-2 to FR-LC-4: the score, its evidence and what to do next. */
export function ReadinessPanel({
  control,
  eventId,
}: Readonly<{ control: LaunchControl; eventId: string }>) {
  const readiness = useQuery({
    queryKey: eventKeys.readiness(control.workspaceId, eventId),
    queryFn: ({ signal }) =>
      api(`/events/${eventId}/readiness`, {
        schema: Readiness,
        workspaceId: control.workspaceId,
        signal,
      }),
    refetchInterval: LIVE_REFRESH_MS,
  });

  return (
    <aside
      aria-labelledby="readiness-heading"
      className="grid gap-4 rounded-xl border p-5 lg:sticky lg:top-6"
    >
      <h2 id="readiness-heading" className="text-lg font-semibold">
        Readiness
      </h2>
      {readiness.isPending ? <p role="status">Assessing readiness…</p> : null}
      {readiness.isError ? (
        <p role="alert">Could not assess readiness.</p>
      ) : null}
      {readiness.isSuccess ? <Assessment readiness={readiness.data} /> : null}
    </aside>
  );
}

function Assessment({ readiness }: Readonly<{ readiness: Readiness }>) {
  return (
    <>
      <p>
        <span className="text-4xl font-semibold">{readiness.score}</span>
        <span className="text-muted-foreground"> / 100</span>
      </p>
      <div aria-hidden="true" className="h-2 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-primary"
          style={{ width: `${String(readiness.score)}%` }}
        />
      </div>
      <p className="text-sm">
        {readiness.blockers.length === 0
          ? "No hard blockers: the event can be marked ready."
          : `${String(readiness.blockers.length)} hard ${readiness.blockers.length === 1 ? "blocker" : "blockers"} must be resolved before the event can be marked ready or go live.`}
      </p>
      <ul className="grid gap-3" aria-label="Criteria">
        {readiness.criteria.map((criterion) => (
          <li key={criterion.criterion} className="grid gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {CRITERION_LABELS[criterion.criterion]}
              </span>
              <span className="text-muted-foreground">
                {criterion.score}/{criterion.maxScore}
              </span>
              {criterion.blocking ? (
                <Badge variant="destructive">Blocker</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">{criterion.evidence}</p>
          </li>
        ))}
      </ul>
      {readiness.nextActions.length === 0 ? null : (
        <div className="grid gap-2">
          <h3 className="font-medium">Next actions</h3>
          <ol className="grid list-decimal gap-1 pl-5 text-sm">
            {readiness.nextActions.map((action) => (
              <li key={action.criterion}>
                <a
                  href={`#${SECTION_IDS[action.section]}`}
                  className="underline-offset-4 hover:underline"
                >
                  {action.action}
                </a>{" "}
                <span className="text-muted-foreground">(+{action.gain})</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Rule version {readiness.ruleVersion}
      </p>
    </>
  );
}
