"use client";

import {
  Readiness,
  type ReadinessCriterion,
  type ReadinessSection,
} from "@goliveboard/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";

import { Term } from "@/components/term";
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

/** The event's readiness, shared by the panel and the header (one request). */
export function useReadiness(control: LaunchControl, eventId: string) {
  return useQuery({
    queryKey: eventKeys.readiness(control.workspaceId, eventId),
    queryFn: ({ signal }) =>
      api(`/events/${eventId}/readiness`, {
        schema: Readiness,
        workspaceId: control.workspaceId,
        signal,
      }),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/** FR-LC-2 to FR-LC-4: the score, its evidence and what to do next. */
export function ReadinessPanel({
  control,
  eventId,
}: Readonly<{ control: LaunchControl; eventId: string }>) {
  const readiness = useReadiness(control, eventId);

  return (
    <aside
      aria-labelledby="readiness-heading"
      className="grid gap-4 rounded-2xl border bg-card p-5 sm:p-6 lg:sticky lg:top-6"
    >
      <div className="flex flex-wrap items-center">
        <h2 id="readiness-heading" className="text-lg font-semibold">
          Readiness
        </h2>
        <Term term="readiness" label="Readiness" />
      </div>
      {readiness.isPending ? <p role="status">Assessing readiness…</p> : null}
      {readiness.isError ? (
        <p role="alert">Could not assess readiness.</p>
      ) : null}
      {readiness.isSuccess ? <Assessment readiness={readiness.data} /> : null}
    </aside>
  );
}

function Assessment({ readiness }: Readonly<{ readiness: Readiness }>) {
  const blocked = readiness.blockers.length > 0;
  return (
    <>
      <p className="flex items-baseline gap-1">
        <span className="figures text-5xl font-semibold tracking-tight">
          {readiness.score}
        </span>
        <span className="figures text-lg text-subtle-foreground">/100</span>
      </p>
      <div
        aria-hidden="true"
        className="h-2 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-2 rounded-full",
            blocked ? "bg-primary" : "bg-success",
          )}
          style={{ width: `${String(readiness.score)}%` }}
        />
      </div>
      <p
        className={cn(
          "text-sm",
          blocked ? "font-medium text-danger" : "text-success",
        )}
      >
        {blocked
          ? `${String(readiness.blockers.length)} hard ${readiness.blockers.length === 1 ? "blocker" : "blockers"} must be resolved before the event can be marked ready or go live.`
          : "No hard blockers: the event can be marked ready."}
      </p>
      <ul className="grid divide-y" aria-label="Criteria">
        {readiness.criteria.map((criterion) => {
          const status = statusOf(criterion);
          return (
            <li
              key={criterion.criterion}
              className="grid gap-1 py-3 text-sm first:pt-0"
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-semibold",
                    STATUS_STYLES[status.tone],
                  )}
                >
                  {status.label}
                </span>
                <span className="flex-1 font-medium">
                  {CRITERION_LABELS[criterion.criterion]}
                </span>
                <span className="figures text-muted-foreground">
                  {criterion.score}/{criterion.maxScore}
                </span>
              </div>
              <p className="text-muted-foreground">{criterion.evidence}</p>
            </li>
          );
        })}
      </ul>
      {readiness.nextActions.length === 0 ? null : (
        <div className="grid gap-2 rounded-xl bg-muted p-4">
          <h3 className="font-medium">Next actions</h3>
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            {readiness.nextActions.map((action) => (
              <li key={action.criterion}>
                <a
                  href={`#${SECTION_IDS[action.section]}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {action.action}
                </a>{" "}
                <span className="figures text-muted-foreground">
                  (+{action.gain})
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="text-xs text-subtle-foreground">
        Rule version {readiness.ruleVersion}
      </p>
    </>
  );
}

type Tone = "blocking" | "passed" | "partial";

const STATUS_STYLES: Readonly<Record<Tone, string>> = {
  blocking: "bg-danger-soft text-danger",
  passed: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
};

/** A criterion at a glance: a blocker, full marks, or something short of them. */
export function statusOf(criterion: {
  blocking: boolean;
  score: number;
  maxScore: number;
}): { tone: Tone; label: string } {
  if (criterion.blocking) {
    return { tone: "blocking", label: "Blocker" };
  }
  return criterion.score === criterion.maxScore
    ? { tone: "passed", label: "Passed" }
    : { tone: "partial", label: "Partial" };
}
