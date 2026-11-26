"use client";

import { EventDetail, Incident, StreamCheckPage } from "@goliveboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SubmitEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatInZone } from "@/lib/time";

import { eventKeys } from "../events/event-keys";
import { useMe } from "../shell/me-context";
import { Section } from "./section";
import { LIVE_REFRESH_MS, type LaunchControl } from "./use-launch-control";

/** Shown in Launch Control; the full history is in the API. */
const RECENT_CHECKS = 5;

/** FR-ST-1 and FR-ST-2: the stream URL, its checks and incidents. */
export function StreamSection({
  control,
  event,
  demoStreamUrl,
}: Readonly<{
  control: LaunchControl;
  event: EventDetail;
  demoStreamUrl?: string;
}>) {
  const { isDemo } = useMe().activeWorkspace;
  return (
    <Section
      id="stream"
      title="Stream"
      description="The HLS link from your streaming provider. GoLiveBoard checks it every 30 seconds; while it fails, the event cannot go live, and once live a failure opens an incident."
    >
      {control.canEdit ? (
        <StreamUrlForm
          key={event.streamUrl}
          control={control}
          event={event}
          demoStreamUrl={isDemo ? (demoStreamUrl ?? null) : undefined}
        />
      ) : (
        <p>{event.streamUrl ?? "No stream URL has been set."}</p>
      )}
      <RecentChecks control={control} event={event} />
    </Section>
  );
}

/**
 * In the demo (`demoStreamUrl` not undefined) nobody may enter an address:
 * stream checks would send requests wherever strangers point them. The
 * deployment's test stream, when it has one, is one button away instead.
 */
function StreamUrlForm({
  control,
  event,
  demoStreamUrl,
}: Readonly<{
  control: LaunchControl;
  event: EventDetail;
  demoStreamUrl?: string | null;
}>) {
  const [url, setUrl] = useState(event.streamUrl ?? demoStreamUrl ?? "");
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
    <form method="post" onSubmit={submit} noValidate className="grid gap-3">
      <FormAlert message={error} />
      {demoStreamUrl === undefined ? (
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
      ) : (
        <p className="text-sm text-muted-foreground">
          {demoStreamUrl === null
            ? "Stream checks are switched off in the demo, because they send requests to the address entered."
            : "In the demo, stream checks use a public test stream, so the event can still become ready and go live."}
        </p>
      )}
      <div className="flex gap-2">
        {demoStreamUrl === null ? null : (
          <Button type="submit" disabled={save.isPending}>
            {demoStreamUrl === undefined
              ? "Save stream URL"
              : "Use the demo test stream"}
          </Button>
        )}
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
    refetchInterval: LIVE_REFRESH_MS,
  });
  const incidents = useQuery({
    queryKey: eventKeys.incidents(workspaceId, event.id),
    queryFn: ({ signal }) =>
      api(`/events/${event.id}/incidents`, {
        schema: z.array(Incident),
        workspaceId,
        signal,
      }),
    refetchInterval: LIVE_REFRESH_MS,
  });
  // A new check can change readiness and open or resolve an incident: show
  // those at the same moment as the check itself.
  const queryClient = useQueryClient();
  const latestCheck = checks.data?.items[0]?.id;
  useEffect(() => {
    if (latestCheck === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: eventKeys.readiness(workspaceId, event.id),
    });
    void queryClient.invalidateQueries({
      queryKey: eventKeys.incidents(workspaceId, event.id),
    });
  }, [latestCheck, queryClient, workspaceId, event.id]);
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
