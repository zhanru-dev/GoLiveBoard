"use client";

import { Blocker, EventDetail, type EventStatus } from "@goliveboard/contracts";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { formatInZone } from "@/lib/time";

import { EventLifecycle } from "../events/event-lifecycle";
import { EventStatusBadge, transitionLabel } from "../events/event-status";
import { EventTabs } from "../events/event-tabs";
import { useReadiness } from "./readiness-panel";
import type { LaunchControl } from "./use-launch-control";

/** Moves that cannot be undone are confirmed first. */
const CONFIRM: ReadonlySet<EventStatus> = new Set([
  "CANCELLED",
  "ARCHIVED",
  "COMPLETED",
]);

interface Refusal {
  readonly message: string;
  readonly blockers: Blocker[];
}

function refusalFrom(error: unknown): Refusal {
  const blockers =
    error instanceof ApiError
      ? (z.array(Blocker).safeParse(error.problem.blockers).data ?? [])
      : [];
  return { message: errorMessage(error), blockers };
}

export function EventHeader({
  control,
  event,
}: Readonly<{ control: LaunchControl; event: EventDetail }>) {
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const readiness = useReadiness(control, event.id);
  const move = useMutation({
    mutationFn: (to: EventStatus) =>
      api(`/events/${event.id}/transitions`, {
        method: "POST",
        body: { to },
        schema: EventDetail,
        workspaceId: control.workspaceId,
      }),
    onMutate: () => {
      setRefusal(undefined);
    },
    onSuccess: (updated) => {
      toast.success(`The event is now ${updated.status.toLowerCase()}.`);
    },
    onError: (error) => {
      setRefusal(refusalFrom(error));
    },
    onSettled: () => control.refresh(),
  });

  return (
    <header className="grid gap-4">
      <Link
        href="/events"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← All events
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <EventStatusBadge status={event.status} />
      </div>
      <p className="text-muted-foreground">
        {formatInZone(event.startsAt, event.timeZone)} –{" "}
        {formatInZone(event.endsAt, event.timeZone)}
      </p>
      <EventTabs event={event} current="launch-control" />
      <EventLifecycle
        status={event.status}
        blockers={readiness.data?.blockers.length}
      />
      {control.canEdit && event.allowedTransitions.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Change status"
          role="group"
        >
          {event.allowedTransitions.map((to) =>
            CONFIRM.has(to) ? (
              <ConfirmTransition
                key={to}
                label={transitionLabel(event.status, to)}
                disabled={move.isPending}
                onConfirm={() => {
                  move.mutate(to);
                }}
              />
            ) : (
              <Button
                key={to}
                variant={to === "LIVE" ? "destructive" : "default"}
                disabled={move.isPending}
                onClick={() => {
                  move.mutate(to);
                }}
              >
                {transitionLabel(event.status, to)}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {refusal === undefined ? null : (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{refusal.message}</AlertTitle>
          {refusal.blockers.length === 0 ? null : (
            <AlertDescription>
              <ul className="list-disc pl-5">
                {refusal.blockers.map((blocker) => (
                  <li key={blocker.criterion}>{blocker.evidence}</li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}
    </header>
  );
}

function ConfirmTransition({
  label,
  disabled,
  onConfirm,
}: Readonly<{ label: string; disabled: boolean; onConfirm: () => void }>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
