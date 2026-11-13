"use client";

import { ApiError } from "@/lib/api";

import { AccessPolicySection } from "./access-policy-section";
import { DetailsSection } from "./details-section";
import { EventHeader } from "./event-header";
import { HoldingSlateSection } from "./holding-slate-section";
import { ReadinessPanel } from "./readiness-panel";
import { RunbookSection } from "./runbook-section";
import { StreamSection } from "./stream-section";
import { useLaunchControl } from "./use-launch-control";

/**
 * Launch Control (FR-LC-1 to FR-LC-4): everything that decides whether the
 * event can go live, with the readiness score that sums it up.
 */
export function LaunchControlPage({ eventId }: Readonly<{ eventId: string }>) {
  const control = useLaunchControl(eventId);
  const { event } = control;

  if (event.isPending) {
    return <p role="status">Loading the event…</p>;
  }
  if (event.isError) {
    const missing =
      event.error instanceof ApiError && event.error.problem.status === 404;
    return (
      <p role="alert">
        {missing ? "This event was not found." : "Could not load the event."}
      </p>
    );
  }
  return (
    <div className="grid gap-8">
      <EventHeader control={control} event={event.data} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="grid gap-8">
          <RunbookSection control={control} event={event.data} />
          <AccessPolicySection control={control} eventId={eventId} />
          <StreamSection control={control} event={event.data} />
          <HoldingSlateSection control={control} eventId={eventId} />
          <DetailsSection control={control} event={event.data} />
        </div>
        <ReadinessPanel control={control} eventId={eventId} />
      </div>
    </div>
  );
}
