"use client";

import { useSyncExternalStore } from "react";

import { formatInZone } from "@/lib/time";

const noSubscription = () => () => undefined;

/**
 * The event's start and end in the visitor's own time zone (FR-AD-1). The
 * server does not know that zone, so it renders the event's; the browser
 * then shows its own.
 */
export function EventTime({
  startsAt,
  endsAt,
  eventTimeZone,
}: Readonly<{ startsAt: string; endsAt: string; eventTimeZone: string }>) {
  const zone = useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => eventTimeZone,
  );
  return (
    <p className="text-muted-foreground">
      <time dateTime={startsAt}>{formatInZone(startsAt, zone)}</time>
      {" – "}
      <time dateTime={endsAt}>{formatInZone(endsAt, zone)}</time>
    </p>
  );
}
