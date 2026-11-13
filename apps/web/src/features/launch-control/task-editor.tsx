"use client";

import { RunbookTask } from "@opspilot/contracts";
import { useMutation } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { utcToZoned } from "@/lib/time";

import { planFields, type TaskPlan, TaskPlanFields } from "./task-fields";
import type { LaunchControl } from "./use-launch-control";

/**
 * Edits a task in place. Only changed fields are sent, with the version the
 * task was loaded at, so a concurrent edit is refused rather than lost.
 */
export function TaskEditor({
  control,
  task,
  timeZone,
  onDone,
}: Readonly<{
  control: LaunchControl;
  task: RunbookTask;
  timeZone: string;
  onDone: () => void;
}>) {
  const [title, setTitle] = useState(task.title);
  const [isCritical, setIsCritical] = useState(task.isCritical);
  const [plan, setPlan] = useState<TaskPlan>({
    ownerUserId: task.owner?.userId ?? "",
    dueLocal: task.dueAt === null ? "" : utcToZoned(task.dueAt, timeZone),
  });
  const [error, setError] = useState("");
  const [dueError, setDueError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (body: object) =>
      api(`/runbook-tasks/${task.id}`, {
        method: "PATCH",
        body,
        ifMatch: task.version,
        schema: RunbookTask,
        workspaceId: control.workspaceId,
      }),
    onSuccess: onDone,
    onError: (failure) => {
      setError(errorMessage(failure));
    },
    onSettled: () => control.refresh(),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setDueError(undefined);
    const fields = planFields(plan, timeZone);
    if ("problem" in fields) {
      setDueError(fields.problem);
      return;
    }
    const changes: Record<string, unknown> = {};
    if (title.trim() !== task.title) changes.title = title;
    if (isCritical !== task.isCritical) changes.isCritical = isCritical;
    if (fields.ownerUserId !== (task.owner?.userId ?? null)) {
      changes.ownerUserId = fields.ownerUserId;
    }
    // Compared as wall clocks: an untouched due time is never sent again.
    const originalDue =
      task.dueAt === null ? "" : utcToZoned(task.dueAt, timeZone);
    if (plan.dueLocal !== originalDue) changes.dueAt = fields.dueAt;
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    save.mutate(changes);
  }

  return (
    <form onSubmit={submit} noValidate className="grid w-full gap-3">
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField
          label="Task title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <label className="flex h-8 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={isCritical}
            onChange={(event) => {
              setIsCritical(event.target.checked);
            }}
          />
          Critical
        </label>
      </div>
      <TaskPlanFields
        control={control}
        timeZone={timeZone}
        plan={plan}
        onChange={setPlan}
        dueError={dueError}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save task
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
