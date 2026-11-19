"use client";

import { RunbookTask } from "@opspilot/contracts";
import { useMutation } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { planFields, type TaskPlan, TaskPlanFields } from "./task-fields";
import type { LaunchControl } from "./use-launch-control";

const EMPTY_PLAN: TaskPlan = { ownerUserId: "", dueLocal: "" };

export function AddTaskForm({
  control,
  eventId,
  timeZone,
}: Readonly<{ control: LaunchControl; eventId: string; timeZone: string }>) {
  const [title, setTitle] = useState("");
  const [isCritical, setIsCritical] = useState(false);
  const [plan, setPlan] = useState<TaskPlan>(EMPTY_PLAN);
  const [error, setError] = useState("");
  const [dueError, setDueError] = useState<string | undefined>();
  const add = useMutation({
    mutationFn: (body: object) =>
      api(`/events/${eventId}/runbook-tasks`, {
        method: "POST",
        body,
        schema: RunbookTask,
        workspaceId: control.workspaceId,
      }),
    onSuccess: () => {
      setTitle("");
      setIsCritical(false);
      setPlan(EMPTY_PLAN);
    },
    onError: (failure) => {
      setError(errorMessage(failure));
    },
    onSettled: () => control.refresh(),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setDueError(undefined);
    if (title.trim() === "") {
      setError("Enter what needs doing.");
      return;
    }
    const fields = planFields(plan, timeZone);
    if ("problem" in fields) {
      setDueError(fields.problem);
      return;
    }
    add.mutate({ title, isCritical, ...fields });
  }

  return (
    <form
      method="post"
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-lg border border-dashed p-3"
    >
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField
          label="New task"
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
      <Button
        type="submit"
        variant="outline"
        disabled={add.isPending}
        className="justify-self-start"
      >
        Add task
      </Button>
    </form>
  );
}
