"use client";

import type { LiveOps, LiveOpsMoment } from "@goliveboard/contracts";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { timeInZone } from "@/lib/time";

import { MinuteChart } from "../charts/minute-chart";
import { EventTabs } from "../events/event-tabs";
import { EventStatusBadge, STATUS_LABELS } from "../events/event-status";
import { type Connection, useLiveOps } from "./use-live-ops";
import { ErrorBoundary } from "@/components/error-boundary";

const CONNECTION_TEXT: Record<Connection, string> = {
  CONNECTING: "Connecting…",
  LIVE: "Live",
  RECONNECTING: "Reconnecting…",
  LOST: "Disconnected",
};

/** FR-RN-7: the live state of an event, for every role. */
export function OpsRoomPage({ eventId }: Readonly<{ eventId: string }>) {
  const { room, connection, retry } = useLiveOps(eventId);
  return (
    // The control room is dark (docs/design/ui-direction.md): `.ink` turns
    // every component inside it dark.
    <div className="ink grid gap-8 rounded-3xl bg-background p-5 text-foreground sm:p-8">
      <header className="grid gap-2">
        {room === undefined ? (
          <Link
            href={`/events/${eventId}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Launch Control
          </Link>
        ) : (
          <EventTabs event={room.event} current="ops-room" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {room?.event.status === "LIVE" ? (
            <span className="flex items-center gap-2 rounded-md bg-live px-2.5 py-1 text-xs font-bold tracking-widest text-live-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-live-foreground motion-safe:animate-pulse"
              />
              ON AIR
            </span>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">
            {room === undefined
              ? "Operations room"
              : `Operations room: ${room.event.title}`}
          </h1>
          {room === undefined ? null : (
            <EventStatusBadge status={room.event.status} />
          )}
          <p role="status" className="ml-auto text-sm text-muted-foreground">
            {CONNECTION_TEXT[connection]}
          </p>
        </div>
      </header>
      {connection === "LOST" ? (
        <Alert variant="destructive">
          <AlertTitle>The live updates stopped</AlertTitle>
          <AlertDescription>
            <p>
              You may have been signed out, or no longer have access to this
              event.
            </p>
            <Button variant="outline" onClick={retry} className="mt-2 w-fit">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {room !== undefined ? <Room room={room} /> : null}
      {room === undefined && connection !== "LOST" ? <p>Loading…</p> : null}
    </div>
  );
}

/**
 * The open incidents come first and stand alone; the figures, the chart and
 * the timeline each fail on their own (error-boundary.tsx), so a broken
 * chart never hides an incident.
 */
function Room({ room }: Readonly<{ room: LiveOps }>) {
  const zone = room.event.timeZone;
  return (
    <>
      <section aria-labelledby="incidents-heading" className="grid gap-2">
        <h2 id="incidents-heading" className="text-lg font-semibold">
          Open incidents
        </h2>
        {/* Incidents are announced at once (docs/05, accessibility). */}
        <div aria-live="assertive" aria-atomic="true">
          {room.incidents.length === 0 ? (
            <p className="text-muted-foreground">None.</p>
          ) : (
            <ul className="grid gap-2">
              {room.incidents.map((incident) => (
                <li key={incident.id}>
                  <Alert variant="destructive">
                    <AlertTitle>
                      Stream unreachable since{" "}
                      {timeInZone(incident.openedAt, zone)}
                    </AlertTitle>
                  </Alert>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <ErrorBoundary what="the figures">
        <section
          aria-label="Figures"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Tile title="Stream">
            {room.stream === null ? (
              <p>Not checked yet</p>
            ) : (
              <>
                <p
                  className={`flex items-center gap-2 text-2xl font-semibold ${room.stream.ok ? "" : "text-danger"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full ${room.stream.ok ? "bg-success" : "bg-live"}`}
                  />
                  {room.stream.ok ? "Reachable" : "Unreachable"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {room.stream.ok
                    ? `${String(room.stream.latencyMs)} ms, `
                    : ""}
                  checked at {timeInZone(room.stream.checkedAt, zone)}
                </p>
              </>
            )}
          </Tile>
          <Tile title="Watching now">
            <p className="figures text-3xl font-semibold">
              {room.audience.current}
            </p>
            <p className="text-sm text-muted-foreground">
              Peak {room.audience.peak}
            </p>
          </Tile>
          <Tile title="Chat">
            <p className="figures text-3xl font-semibold">
              {room.rates.messagesPerMinute}
            </p>
            <p className="text-sm text-muted-foreground">messages a minute</p>
          </Tile>
          <Tile title="Questions">
            <p className="figures text-3xl font-semibold">
              {room.rates.questionsPerMinute}
            </p>
            <p className="text-sm text-muted-foreground">questions a minute</p>
          </Tile>
        </section>
      </ErrorBoundary>
      <ErrorBoundary what="the audience chart">
        <section aria-labelledby="audience-heading" className="grid gap-2">
          <h2 id="audience-heading" className="text-lg font-semibold">
            Audience
          </h2>
          <MinuteChart
            label="Viewers per minute"
            unit="viewers"
            timeZone={zone}
            points={room.audience.series.map(({ minute, viewers }) => ({
              minute,
              value: viewers,
            }))}
          />
        </section>
      </ErrorBoundary>
      <ErrorBoundary what="the timeline">
        <section aria-labelledby="timeline-heading" className="grid gap-2">
          <h2 id="timeline-heading" className="text-lg font-semibold">
            Timeline
          </h2>
          {room.timeline.length === 0 ? (
            <p className="text-muted-foreground">Nothing yet.</p>
          ) : (
            <ol className="grid gap-1">
              {room.timeline.map((moment, index) => (
                // The timeline only grows at its end.
                <li key={index}>
                  <time
                    dateTime={moment.at}
                    className="figures mr-2 text-muted-foreground"
                  >
                    {timeInZone(moment.at, zone)}
                  </time>{" "}
                  {describe(moment)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </ErrorBoundary>
    </>
  );
}

function Tile({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="sr-only">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function describe(moment: LiveOpsMoment): string {
  switch (moment.kind) {
    case "STATUS_CHANGED":
      return `${STATUS_LABELS[moment.from]} → ${STATUS_LABELS[moment.to]}`;
    case "INCIDENT_OPENED":
      return "Stream unreachable";
    case "INCIDENT_RESOLVED":
      return "Stream back";
  }
}
