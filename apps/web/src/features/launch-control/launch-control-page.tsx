"use client";

import { useEffect } from "react";

import { ApiError } from "@/lib/api";

import { remember } from "../onboarding/visits";

import { AccessPolicySection } from "./access-policy-section";
import { AudienceSection } from "./audience-section";
import { DetailsSection } from "./details-section";
import { EventHeader } from "./event-header";
import { HoldingSlateSection } from "./holding-slate-section";
import { LiveSection } from "./live-section";
import { ReadinessPanel } from "./readiness-panel";
import { RunbookSection } from "./runbook-section";
import { StreamSection } from "./stream-section";
import { useLaunchControl } from "./use-launch-control";
import { ErrorBoundary } from "@/components/error-boundary";

/**
 * Launch Control (FR-LC-1 to FR-LC-4): everything that decides whether the
 * event can go live, with the readiness score that sums it up.
 */
export function LaunchControlPage({
  eventId,
  demoStreamUrl,
}: Readonly<{
  eventId: string;
  /** The one stream the demo workspace may use (DEMO_STREAM_URL). */
  demoStreamUrl?: string;
}>) {
  const control = useLaunchControl(eventId);
  const { event, workspaceId } = control;
  // For the demo guide: this browser has opened a Launch Control.
  useEffect(() => {
    remember(workspaceId, "launch-control");
  }, [workspaceId]);

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
        {/* Each part fails on its own: one that cannot render leaves the
            others working (error-boundary.tsx). */}
        <div className="grid gap-8">
          <ErrorBoundary what="the runbook">
            <RunbookSection control={control} event={event.data} />
          </ErrorBoundary>
          <ErrorBoundary what="the access policy">
            <AccessPolicySection control={control} eventId={eventId} />
          </ErrorBoundary>
          <ErrorBoundary what="the stream">
            <StreamSection
              control={control}
              event={event.data}
              demoStreamUrl={demoStreamUrl}
            />
          </ErrorBoundary>
          <ErrorBoundary what="the holding slate">
            <HoldingSlateSection control={control} eventId={eventId} />
          </ErrorBoundary>
          <ErrorBoundary what="the audience">
            <AudienceSection control={control} event={event.data} />
          </ErrorBoundary>
          <ErrorBoundary what="the live controls">
            <LiveSection control={control} event={event.data} />
          </ErrorBoundary>
          <ErrorBoundary what="the event's details">
            <DetailsSection control={control} event={event.data} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary what="the readiness panel">
          <ReadinessPanel control={control} eventId={eventId} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
