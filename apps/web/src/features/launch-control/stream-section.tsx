"use client";

import { EventDetail, Incident, StreamCheckPage } from "@opspilot/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type SubmitEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatInZone } from "@/lib/time";

import { eventKeys } from "../events/event-keys";
import { Section } from "./section";
import type { LaunchControl } from "./use-launch-control";

/** Shown in Launch Control; the full history is in the API. */
const RECENT_CHECKS = 5;

/** FR-ST-1 and FR-ST-2: the stream URL, its checks and incidents. */
export function StreamSection({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  return (
    <Section id="stream" title="Stream">
      {control.canEdit ? (
        <StreamUrlForm key={event.streamUrl} control={control} event={event} />
      ) : (
        <p>{event.streamUrl ?? "No stream URL has been set."}</p>
      )}
      <RecentChecks control={control} event={event} />
    </Section>
  );
}

function StreamUrlForm({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const [url, setUrl] = useState(event.streamUrl ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/events/${event.id}/stream`, {
        method: "PUT",
        body: { url },
        schema: EventDetail,
        workspaceId: control.workspaceId,
      }),
    onSuccess: () => toast.success("Stream URL saved; checking it now"),
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
  const check = useMutation({
    mutationFn: () =>
      api(`/events/${event.id}/stream/checks`, {
        method: "POST",
        workspaceId: control.workspaceId,
      }),
    onSuccess: () => toast.success("Checking the stream…"),
    onError: (failure) => toast.error(errorMessage(failure)),
    onSettled: () => control.refresh(),
  });

  function submit(formEvent: SubmitEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <FormAlert message={error} />
      <FormField
        label="HLS playback URL"
        type="url"
        placeholder="https://stream.example.com/live/index.m3u8"
        hint="From your streaming provider (Mux, AWS IVS, Cloudflare Stream…)."
        value={url}
        onChange={(changeEvent) => {
          setUrl(changeEvent.target.value);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save stream URL
        </Button>
        {event.streamUrl === null ? null : (
          <Button
            type="button"
            variant="outline"
            disabled={check.isPending}
            onClick={() => {
              check.mutate();
            }}
          >
            Check now
          </Button>
        )}
      </div>
    </form>
  );
}

function RecentChecks({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const { workspaceId } = control;
  const checks = useQuery({
    queryKey: eventKeys.streamChecks(workspaceId, event.id),
    queryFn: ({ signal }) =>
      api(`/events/${event.id}/stream/checks?limit=${String(RECENT_CHECKS)}`, {
        schema: StreamCheckPage,
        workspaceId,
        signal,
      }),
    // A requested check finishes a moment later in the worker.
    refetchInterval: 10_000,
  });
  const incidents = useQuery({
    queryKey: eventKeys.incidents(workspaceId, event.id),
    queryFn: ({ signal }) =>
      api(`/events/${event.id}/incidents`, {
        schema: z.array(Incident),
        workspaceId,
        signal,
      }),
  });
  const open =
    incidents.data?.filter((incident) => incident.resolvedAt === null) ?? [];

  return (
    <div className="grid gap-2">
      {open.length > 0 ? (
        <p role="alert" className="font-medium text-destructive">
          Stream unreachable since{" "}
          {formatInZone(open[0]?.openedAt ?? "", event.timeZone)}
        </p>
      ) : null}
      <h3 className="font-medium">Recent checks</h3>
      {checks.isSuccess && checks.data.items.length === 0 ? (
        <p className="text-muted-foreground">Not checked yet.</p>
      ) : null}
      {checks.isError ? (
        <p role="alert">Could not load the stream checks.</p>
      ) : null}
      <ul className="grid gap-1 text-sm">
        {checks.data?.items.map((item) => (
          <li key={item.id}>
            {formatInZone(item.checkedAt, event.timeZone)}:{" "}
            {item.ok
              ? `reachable (HTTP ${String(item.httpStatus)}, ${String(item.latencyMs)} ms)`
              : `failed: ${item.failure ?? "unknown"}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
