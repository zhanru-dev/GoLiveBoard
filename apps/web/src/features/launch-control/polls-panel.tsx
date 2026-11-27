"use client";

import {
  CreatePollRequest,
  Poll,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
} from "@goliveboard/contracts";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { PollResults } from "../live/poll-results";

const STATUS_LABELS = {
  DRAFT: "Draft",
  OPEN: "Open",
  CLOSED: "Closed",
} as const;

/**
 * Live polls in Launch Control (FR-RN-8): Managers prepare drafts and run
 * one at a time; every role sees the counts live.
 */
export function PollsPanel({
  eventId,
  workspaceId,
  polls,
  canEdit,
  open,
  onChange,
  onDeleted,
}: Readonly<{
  eventId: string;
  workspaceId: string;
  polls: readonly Poll[];
  canEdit: boolean;
  /** Whether the event takes interaction now. */
  open: boolean;
  onChange: (poll: Poll) => void;
  onDeleted: (pollId: string) => void;
}>) {
  const run = useMutation({
    mutationFn: ({ poll, action }: { poll: Poll; action: "open" | "close" }) =>
      api(`/polls/${poll.id}/${action}`, {
        method: "POST",
        schema: Poll,
        workspaceId,
      }),
    onSuccess: onChange,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (poll: Poll) =>
      api(`/polls/${poll.id}`, {
        method: "DELETE",
        ifMatch: poll.version,
        workspaceId,
      }),
    onSuccess: (_, poll) => {
      onDeleted(poll.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const someOpen = polls.some(({ status }) => status === "OPEN");

  return (
    <div className="grid gap-3">
      <h3 className="font-medium">Polls</h3>
      {canEdit && open ? (
        <NewPoll
          eventId={eventId}
          workspaceId={workspaceId}
          onCreated={onChange}
        />
      ) : null}
      {polls.length === 0 ? (
        <p className="text-sm text-muted-foreground">No polls yet.</p>
      ) : (
        <ol className="grid gap-2" aria-label="Polls">
          {polls.map((poll) => (
            <li
              key={poll.id}
              className="grid gap-2 rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="grow font-medium">{poll.question}</p>
                <Badge variant="outline">{STATUS_LABELS[poll.status]}</Badge>
              </div>
              {poll.status === "DRAFT" ? (
                <p className="text-muted-foreground">
                  {poll.options.map(({ label }) => label).join(" · ")}
                </p>
              ) : (
                <PollResults poll={poll} />
              )}
              {canEdit && poll.status !== "CLOSED" ? (
                <div className="flex flex-wrap gap-1">
                  {poll.status === "DRAFT" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={run.isPending || someOpen || !open}
                        aria-label={`Open: ${poll.question}`}
                        onClick={() => {
                          run.mutate({ poll, action: "open" });
                        }}
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        aria-label={`Delete: ${poll.question}`}
                        onClick={() => {
                          remove.mutate(poll);
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={run.isPending}
                      aria-label={`Close: ${poll.question}`}
                      onClick={() => {
                        run.mutate({ poll, action: "close" });
                      }}
                    >
                      Close
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canEdit && someOpen ? (
        <p className="text-xs text-muted-foreground">
          One poll is open at a time: close it to open another.
        </p>
      ) : null}
    </div>
  );
}

function NewPoll({
  eventId,
  workspaceId,
  onCreated,
}: Readonly<{
  eventId: string;
  workspaceId: string;
  onCreated: (poll: Poll) => void;
}>) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const questionId = useId();
  const draft = { question, options };
  const valid = CreatePollRequest.safeParse(draft).success;
  const create = useMutation({
    mutationFn: () =>
      api(`/events/${eventId}/polls`, {
        method: "POST",
        body: draft,
        schema: Poll,
        workspaceId,
      }),
    onSuccess: (poll) => {
      onCreated(poll);
      setQuestion("");
      setOptions(["", ""]);
      toast.success("Poll saved as a draft");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <form
      method="post"
      className="grid gap-2 rounded-lg border border-dashed p-3"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        if (valid) create.mutate();
      }}
    >
      <Label htmlFor={questionId}>New poll question</Label>
      <Input
        id={questionId}
        value={question}
        maxLength={200}
        onChange={(change) => {
          setQuestion(change.target.value);
        }}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          Options ({POLL_OPTIONS_MIN} to {POLL_OPTIONS_MAX}, each different)
        </legend>
        {options.map((option, index) => (
          // Options have no identity of their own until saved.
          <div key={index} className="flex gap-2">
            <Input
              aria-label={`Option ${String(index + 1)}`}
              value={option}
              maxLength={80}
              onChange={(change) => {
                const next = [...options];
                next[index] = change.target.value;
                setOptions(next);
              }}
            />
            {options.length > POLL_OPTIONS_MIN ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove option ${String(index + 1)}`}
                onClick={() => {
                  setOptions(options.filter((_, at) => at !== index));
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {options.length < POLL_OPTIONS_MAX ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOptions([...options, ""]);
            }}
          >
            Add an option
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!valid || create.isPending}>
          Save as draft
        </Button>
      </div>
    </form>
  );
}
