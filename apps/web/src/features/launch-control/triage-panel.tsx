"use client";

import {
  type Question,
  TriageRun,
  TriageRunStarted,
} from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

/** How often a run's state is read while it is queued or running. */
export const POLL_MS = 1_000;

/** Why no run started, in a moderator's words (docs/04 section 3.6). */
const REFUSALS: Readonly<Record<string, string>> = {
  TRIAGE_UNAVAILABLE: "AI suggestions are not set up on this server.",
  TRIAGE_BUDGET_SPENT: "Today's budget for AI suggestions is spent.",
  TRIAGE_NOTHING_TO_SORT: "There are no open questions to sort.",
  RATE_LIMITED: "Suggestions were asked for often; wait a few minutes.",
};

/**
 * AI question triage (FR-RN-6): the model suggests groups of questions that
 * ask the same thing and an order to answer them in; nothing changes until
 * a moderator merges the groups they choose. If the model fails, the panel
 * says so and Q&A carries on as usual.
 */
export function TriagePanel({
  eventId,
  workspaceId,
  questions,
}: Readonly<{
  eventId: string;
  workspaceId: string;
  questions: readonly Question[];
}>) {
  const [runId, setRunId] = useState<string>();
  const [refusal, setRefusal] = useState<string>();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());

  const start = useMutation({
    mutationFn: () =>
      api(`/events/${eventId}/question-triage-runs`, {
        method: "POST",
        schema: TriageRunStarted,
        workspaceId,
      }),
    onMutate: () => {
      setRefusal(undefined);
      setChosen(new Set());
    },
    onSuccess: ({ id }) => {
      setRunId(id);
    },
    onError: (error) => {
      setRefusal(
        (error instanceof ApiError
          ? REFUSALS[error.problem.code]
          : undefined) ?? errorMessage(error),
      );
    },
  });
  const run = useQuery({
    queryKey: ["triage-run", workspaceId, runId],
    enabled: runId !== undefined,
    queryFn: ({ signal }) =>
      api(`/question-triage-runs/${runId ?? ""}`, {
        schema: TriageRun,
        workspaceId,
        signal,
      }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || status === "QUEUED" || status === "RUNNING"
        ? POLL_MS
        : false;
    },
  });
  const decide = useMutation({
    mutationFn: (acceptedGroups: number[]) =>
      api(`/question-triage-runs/${runId ?? ""}/decision`, {
        method: "POST",
        body: { acceptedGroups },
        schema: TriageRun,
        workspaceId,
      }),
    onSuccess: (decided, acceptedGroups) => {
      setRunId(undefined);
      if (acceptedGroups.length === 0) {
        toast.success("Suggestions dismissed");
        return;
      }
      const merged = acceptedGroups.reduce(
        (sum, index) =>
          sum +
          (decided.suggestions?.groups[index]?.questionIds.length ?? 1) -
          1,
        0,
      );
      toast.success(
        `Merged ${String(merged)} ${merged === 1 ? "question" : "questions"}`,
      );
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  const bodyOf = (id: string) =>
    questions.find((question) => question.id === id)?.body ??
    "(no longer there)";
  const current = runId === undefined ? undefined : run.data;
  const busy =
    start.isPending ||
    (runId !== undefined &&
      (current === undefined ||
        current.status === "QUEUED" ||
        current.status === "RUNNING"));

  return (
    <section aria-labelledby="triage-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="triage-heading" className="font-medium">
          AI suggestions
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || decide.isPending}
          onClick={() => {
            start.mutate();
          }}
        >
          Suggest groups
        </Button>
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Sorting questions…
          </p>
        ) : null}
      </div>
      {refusal === undefined ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {refusal}
        </p>
      )}
      {current?.status === "FAILED" || current?.status === "TIMED_OUT" ? (
        <Alert>
          <AlertTitle>Suggestions are unavailable</AlertTitle>
          <AlertDescription>
            {current.failure ?? "The AI model did not answer."} Q&A works as
            usual.
          </AlertDescription>
        </Alert>
      ) : null}
      {current?.status === "SUCCEEDED" && current.suggestions !== null ? (
        <div className="grid gap-3">
          {current.suggestions.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No questions ask the same thing.
            </p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm">
                Choose the groups to merge into their first question; the others
                leave the public list and their votes move to it.
              </legend>
              {current.suggestions.groups.map((group, index) => (
                <label
                  key={group.representativeId}
                  className="flex items-start gap-2 rounded-lg border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen.has(index)}
                    onChange={(change) => {
                      const next = new Set(chosen);
                      if (change.target.checked) {
                        next.add(index);
                      } else {
                        next.delete(index);
                      }
                      setChosen(next);
                    }}
                  />
                  <span className="grid gap-1">
                    <span className="font-medium">
                      {bodyOf(group.representativeId)}
                    </span>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {group.questionIds
                        .filter((id) => id !== group.representativeId)
                        .map((id) => (
                          <li key={id}>{bodyOf(id)}</li>
                        ))}
                    </ul>
                    <span className="text-xs text-muted-foreground">
                      {group.reason}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {current.suggestions.answerOrder.length === 0 ? null : (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Suggested order to answer</p>
              <ol className="list-decimal pl-5">
                {current.suggestions.answerOrder.map((id) => (
                  <li key={id}>{bodyOf(id)}</li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {current.suggestions.groups.length === 0 ? null : (
              <Button
                size="sm"
                disabled={chosen.size === 0 || decide.isPending}
                onClick={() => {
                  decide.mutate([...chosen].sort((a, b) => a - b));
                }}
              >
                Merge selected
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate([]);
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
