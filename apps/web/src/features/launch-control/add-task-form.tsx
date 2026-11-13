"use client";

import { RunbookTask } from "@opspilot/contracts";
import { useMutation } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import type { LaunchControl } from "./use-launch-control";

export function AddTaskForm({
  control,
  eventId,
}: Readonly<{ control: LaunchControl; eventId: string }>) {
  const [title, setTitle] = useState("");
  const [isCritical, setIsCritical] = useState(false);
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api(`/events/${eventId}/runbook-tasks`, {
        method: "POST",
        body: { title, isCritical },
        schema: RunbookTask,
        workspaceId: control.workspaceId,
      }),
    onSuccess: () => {
      setTitle("");
      setIsCritical(false);
    },
    onError: (failure) => {
      setError(errorMessage(failure));
    },
    onSettled: () => control.refresh(),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (title.trim() === "") {
      setError("Enter what needs doing.");
      return;
    }
    add.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
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
        <Button type="submit" variant="outline" disabled={add.isPending}>
          Add task
        </Button>
      </div>
    </form>
  );
}
