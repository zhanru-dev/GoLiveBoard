"use client";

import { RunbookTask } from "@opspilot/contracts";
import { useMutation } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { utcToZoned } from "@/lib/time";

import { planFields, type TaskPlan, TaskPlanFields } from "./task-fields";
import type { LaunchControl } from "./use-launch-control";

interface EditorProps {
  readonly control: LaunchControl;
  /** The task as it is stored now; refreshes while the editor is open. */
  readonly task: RunbookTask;
  readonly timeZone: string;
  readonly onDone: () => void;
}

/**
 * Edits a task in place. The draft and the version it is based on are taken
 * together when editing starts, and stay together: a refresh that brings a
 * newer version must not pair the old draft with the new version, or saving
 * would overwrite a colleague's change (the milestone 3 re-review). Instead
 * the editor says the task changed and offers to start again from it; saving
 * the old draft sends the old version, which the API refuses.
 */
export function TaskEditor(props: EditorProps) {
  const [base, setBase] = useState(props.task);
  const changedElsewhere = props.task.version !== base.version;
  return (
    <TaskDraft
      // Starting again from the latest version resets every field.
      key={base.version}
      {...props}
      task={base}
      changedElsewhere={changedElsewhere}
      onReload={() => {
        setBase(props.task);
      }}
    />
  );
}

function TaskDraft({
  control,
  task,
  timeZone,
  onDone,
  changedElsewhere,
  onReload,
}: EditorProps & {
  readonly changedElsewhere: boolean;
  readonly onReload: () => void;
}) {
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
    <form
      method="post"
      onSubmit={submit}
      noValidate
      className="grid w-full gap-3"
    >
      {changedElsewhere ? (
        <Alert role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Someone else changed this task while you were editing it.
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReload}
            >
              Start again from their version
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
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
