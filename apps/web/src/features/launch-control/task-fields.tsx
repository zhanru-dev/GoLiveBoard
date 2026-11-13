"use client";

import { Member } from "@opspilot/contracts";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { api } from "@/lib/api";

import { instantFor } from "../events/event-form-values";
import { teamKeys } from "../team/roles";
import type { LaunchControl } from "./use-launch-control";

/** A task's owner and due time as the form holds them. */
export interface TaskPlan {
  readonly ownerUserId: string;
  /** Wall clock in the event's zone, `YYYY-MM-DDTHH:mm`, or "". */
  readonly dueLocal: string;
}

/**
 * The request fields for a plan, or the problem with its due time. A due
 * time the clocks skip or repeat is refused rather than guessed.
 */
export function planFields(
  plan: TaskPlan,
  timeZone: string,
): { ownerUserId: string | null; dueAt: string | null } | { problem: string } {
  if (plan.dueLocal === "") {
    return {
      ownerUserId: plan.ownerUserId === "" ? null : plan.ownerUserId,
      dueAt: null,
    };
  }
  const due = instantFor(plan.dueLocal, "", timeZone);
  if ("problem" in due) {
    return {
      problem: due.problem.replace(
        "Choose which one you mean.",
        "Choose a time outside that hour.",
      ),
    };
  }
  return {
    ownerUserId: plan.ownerUserId === "" ? null : plan.ownerUserId,
    dueAt: due.utc,
  };
}

/** Owner and due-time inputs, shared by adding and editing a task. */
export function TaskPlanFields({
  control,
  timeZone,
  plan,
  onChange,
  dueError,
}: Readonly<{
  control: LaunchControl;
  timeZone: string;
  plan: TaskPlan;
  onChange: (plan: TaskPlan) => void;
  dueError?: string | undefined;
}>) {
  const members = useQuery({
    queryKey: teamKeys.members(control.workspaceId),
    queryFn: ({ signal }) =>
      api("/workspace/members", {
        schema: z.array(Member),
        workspaceId: control.workspaceId,
        signal,
      }),
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NativeSelect
        label="Task owner"
        value={plan.ownerUserId}
        onChange={(event) => {
          onChange({ ...plan, ownerUserId: event.target.value });
        }}
      >
        <option value="">Nobody yet</option>
        {members.data?.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
          </option>
        ))}
      </NativeSelect>
      <FormField
        label="Due"
        type="datetime-local"
        hint={`In the event's time zone, ${timeZone}.`}
        value={plan.dueLocal}
        error={dueError}
        onChange={(event) => {
          onChange({ ...plan, dueLocal: event.target.value });
        }}
      />
    </div>
  );
}
