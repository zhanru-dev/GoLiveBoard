"use client";

import type { LiveOps, LiveOpsMoment } from "@opspilot/contracts";
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
import { EventStatusBadge, STATUS_LABELS } from "../events/event-status";
import { type Connection, useLiveOps } from "./use-live-ops";

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
    <div className="grid gap-8">
      <header className="grid gap-2">
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Launch Control
        </Link>
        <div className="flex flex-wrap items-center gap-3">
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
      <section
        aria-label="Figures"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Tile title="Stream">
          {room.stream === null ? (
            <p>Not checked yet</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">
                {room.stream.ok ? "Reachable" : "Unreachable"}
              </p>
              <p className="text-sm text-muted-foreground">
                {room.stream.ok ? `${String(room.stream.latencyMs)} ms, ` : ""}
                checked at {timeInZone(room.stream.checkedAt, zone)}
              </p>
            </>
          )}
        </Tile>
        <Tile title="Watching now">
          <p className="text-2xl font-semibold">{room.audience.current}</p>
          <p className="text-sm text-muted-foreground">
            Peak {room.audience.peak}
          </p>
        </Tile>
        <Tile title="Chat">
          <p className="text-2xl font-semibold">
            {room.rates.messagesPerMinute}
          </p>
          <p className="text-sm text-muted-foreground">messages a minute</p>
        </Tile>
        <Tile title="Questions">
          <p className="text-2xl font-semibold">
            {room.rates.questionsPerMinute}
          </p>
          <p className="text-sm text-muted-foreground">questions a minute</p>
        </Tile>
      </section>
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
                <time dateTime={moment.at} className="tabular-nums">
                  {timeInZone(moment.at, zone)}
                </time>{" "}
                {describe(moment)}
              </li>
            ))}
          </ol>
        )}
      </section>
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
