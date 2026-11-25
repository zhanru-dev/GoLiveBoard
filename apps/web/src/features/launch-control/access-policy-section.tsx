"use client";

import { AccessPolicy, type AccessMode } from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";
import { toast } from "sonner";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { FormTextarea } from "@/components/form-textarea";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

import { eventKeys } from "../events/event-keys";
import { Section } from "./section";
import type { LaunchControl } from "./use-launch-control";

const MODE_LABELS: Readonly<Record<AccessMode, string>> = {
  PUBLIC: "Anyone can register",
  EMAIL_DOMAIN: "Only these email domains",
  INVITE_ONLY: "Invitation only",
};

/** FR-AD-2: who may register. Missing policy is a hard blocker. */
export function AccessPolicySection({
  control,
  eventId,
}: Readonly<{ control: LaunchControl; eventId: string }>) {
  const { workspaceId } = control;
  const policy = useQuery({
    queryKey: eventKeys.accessPolicy(workspaceId, eventId),
    queryFn: async ({ signal }) => {
      try {
        return await api(`/events/${eventId}/access-policy`, {
          schema: AccessPolicy,
          workspaceId,
          signal,
        });
      } catch (error) {
        // Not set yet: an expected state, not a failure.
        if (error instanceof ApiError && error.problem.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });

  return (
    <Section id="access-policy" title="Access policy">
      {policy.isPending ? (
        <p role="status">Loading the access policy…</p>
      ) : null}
      {policy.isError ? (
        <p role="alert">Could not load the access policy.</p>
      ) : null}
      {policy.isSuccess ? (
        <PolicyForm
          // A new version resets the form to what is stored.
          key={policy.data?.version ?? 0}
          control={control}
          eventId={eventId}
          current={policy.data}
        />
      ) : null}
    </Section>
  );
}

function PolicyForm({
  control,
  eventId,
  current,
}: Readonly<{
  control: LaunchControl;
  eventId: string;
  current: AccessPolicy | null;
}>) {
  const [mode, setMode] = useState<AccessMode>(current?.mode ?? "PUBLIC");
  const [domains, setDomains] = useState(
    current?.allowedDomains.join("\n") ?? "",
  );
  const [notice, setNotice] = useState(current?.privacyNoticeVersion ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/events/${eventId}/access-policy`, {
        method: "PUT",
        body: {
          mode,
          allowedDomains:
            mode === "EMAIL_DOMAIN"
              ? domains.split(/[\s,]+/).filter((domain) => domain !== "")
              : [],
          privacyNoticeVersion: notice,
        },
        // The first save creates the policy and must not send a version.
        ...(current === null ? {} : { ifMatch: current.version }),
        schema: AccessPolicy,
        workspaceId: control.workspaceId,
      }),
    onSuccess: () => toast.success("Access policy saved"),
    onError: (failure) => {
      setError(
        failure instanceof ApiError && failure.problem.errors !== undefined
          ? failure.problem.errors
              .map((fieldError) => fieldError.message)
              .join(" ")
          : errorMessage(failure),
      );
    },
    onSettled: () => control.refresh(),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    save.mutate();
  }

  if (!control.canEdit) {
    return current === null ? (
      <p className="text-muted-foreground">No access policy has been set.</p>
    ) : (
      <p>
        {MODE_LABELS[current.mode]}
        {current.allowedDomains.length > 0
          ? `: ${current.allowedDomains.join(", ")}`
          : ""}
      </p>
    );
  }
  return (
    <form method="post" onSubmit={submit} noValidate className="grid gap-4">
      <FormAlert message={error} />
      <NativeSelect
        label="Who can register"
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as AccessMode);
        }}
      >
        {(Object.keys(MODE_LABELS) as AccessMode[]).map((value) => (
          <option key={value} value={value}>
            {MODE_LABELS[value]}
          </option>
        ))}
      </NativeSelect>
      {mode === "EMAIL_DOMAIN" ? (
        <FormTextarea
          label="Allowed email domains"
          hint="One per line, for example example.com"
          value={domains}
          onChange={(event) => {
            setDomains(event.target.value);
          }}
        />
      ) : null}
      <FormField
        label="Privacy notice version"
        hint="The version attendees agree to when they register."
        value={notice}
        onChange={(event) => {
          setNotice(event.target.value);
        }}
      />
      <Button
        type="submit"
        disabled={save.isPending}
        className="justify-self-start"
      >
        {current === null ? "Set access policy" : "Save access policy"}
      </Button>
    </form>
  );
}
