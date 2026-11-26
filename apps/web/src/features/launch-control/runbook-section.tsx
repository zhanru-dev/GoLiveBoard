"use client";

import { type EventDetail, RunbookTask } from "@goliveboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatInZone } from "@/lib/time";

import { eventKeys } from "../events/event-keys";
import { remember } from "../onboarding/visits";
import { AddTaskForm } from "./add-task-form";
import { Section } from "./section";
import { TaskEditor } from "./task-editor";
import type { LaunchControl } from "./use-launch-control";

const Tasks = z.array(RunbookTask);

/** FR-LC-1: the event's runbook. */
export function RunbookSection({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { workspaceId } = control;
  const eventId = event.id;
  const [editing, setEditing] = useState<string | undefined>();
  const queryClient = useQueryClient();
  const runbookKey = eventKeys.runbook(workspaceId, eventId);
  const tasks = useQuery({
    queryKey: runbookKey,
    queryFn: ({ signal }) =>
      api(`/events/${eventId}/runbook-tasks`, {
        schema: Tasks,
        workspaceId,
        signal,
      }),
  });
  const onError = (error: Error) => toast.error(errorMessage(error));
  const toggle = useMutation({
    mutationFn: (task: RunbookTask) =>
      api(`/runbook-tasks/${task.id}`, {
        method: "PATCH",
        body: { status: task.status === "DONE" ? "TODO" : "DONE" },
        ifMatch: task.version,
        schema: RunbookTask,
        workspaceId,
      }),
    // Tick the box at once; the refresh afterwards shows what was stored,
    // which undoes the tick if the change was refused.
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: runbookKey });
      queryClient.setQueryData<RunbookTask[]>(runbookKey, (current) =>
        current?.map((candidate) =>
          candidate.id === task.id
            ? { ...candidate, status: task.status === "DONE" ? "TODO" : "DONE" }
            : candidate,
        ),
      );
    },
    onSuccess: (task) => {
      if (task.status === "DONE") {
        // For the demo guide: a task has been ticked here.
        remember(workspaceId, "task-done");
      }
    },
    onError,
    onSettled: () => control.refresh(),
  });
  const move = useMutation({
    mutationFn: ({
      task,
      after,
    }: {
      task: RunbookTask;
      after: string | null;
    }) =>
      api(`/runbook-tasks/${task.id}/move`, {
        method: "POST",
        body: { after },
        schema: Tasks,
        workspaceId,
      }),
    onError,
    onSettled: () => control.refresh(),
  });
  const remove = useMutation({
    mutationFn: (task: RunbookTask) =>
      api(`/runbook-tasks/${task.id}`, {
        method: "DELETE",
        ifMatch: task.version,
        workspaceId,
      }),
    onError,
    onSettled: () => control.refresh(),
  });

  return (
    <Section
      id="runbook"
      title="Runbook"
      term="runbook"
      description="The checklist for this event. Mark what must be done before going live as critical: while a critical task is open, the event cannot be marked ready."
    >
      {tasks.isPending ? <p role="status">Loading the runbook…</p> : null}
      {tasks.isError ? <p role="alert">Could not load the runbook.</p> : null}
      {tasks.isSuccess && tasks.data.length === 0 ? (
        <p className="text-muted-foreground">
          No tasks yet. Add the steps your team must finish before going live.
        </p>
      ) : null}
      {tasks.isSuccess && tasks.data.length > 0 ? (
        <ol className="grid gap-2">
          {tasks.data.map((task, index) => {
            // Moving up places the task after the one two places above it.
            const upAnchor =
              index >= 2 ? (tasks.data[index - 2]?.id ?? null) : null;
            const below = tasks.data[index + 1];
            return (
              <li
                key={task.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={task.status === "DONE"}
                  disabled={!control.canEdit || toggle.isPending}
                  aria-label={`${task.title} done`}
                  onChange={() => {
                    toggle.mutate(task);
                  }}
                />
                {editing === task.id ? (
                  <TaskEditor
                    control={control}
                    task={task}
                    timeZone={event.timeZone}
                    onDone={() => {
                      setEditing(undefined);
                    }}
                  />
                ) : (
                  <div className="grid flex-1 gap-0.5">
                    <span
                      className={task.status === "DONE" ? "line-through" : ""}
                    >
                      {task.title}
                    </span>
                    <TaskDetails task={task} timeZone={event.timeZone} />
                  </div>
                )}
                {task.isCritical ? (
                  <Badge variant="destructive">Critical</Badge>
                ) : null}
                {control.canEdit && editing !== task.id ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${task.title}`}
                      onClick={() => {
                        setEditing(task.id);
                      }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${task.title} up`}
                      disabled={index === 0}
                      onClick={() => {
                        move.mutate({ task, after: upAnchor });
                      }}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${task.title} down`}
                      disabled={below === undefined}
                      onClick={() => {
                        if (below !== undefined)
                          move.mutate({ task, after: below.id });
                      }}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${task.title}`}
                      onClick={() => {
                        remove.mutate(task);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {control.canEdit ? (
        <AddTaskForm
          control={control}
          eventId={eventId}
          timeZone={event.timeZone}
        />
      ) : null}
    </Section>
  );
}

/** Owner, due time and completion, in the event's time zone. */
function TaskDetails({
  task,
  timeZone,
}: Readonly<{ task: RunbookTask; timeZone: string }>) {
  const parts = [
    task.owner === null ? null : `Owner: ${task.owner.name}`,
    task.dueAt === null ? null : `Due ${formatInZone(task.dueAt, timeZone)}`,
    task.completedBy === null ? null : `Done by ${task.completedBy.name}`,
  ].filter((part) => part !== null);
  if (parts.length === 0) {
    return null;
  }
  return (
    <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
  );
}
