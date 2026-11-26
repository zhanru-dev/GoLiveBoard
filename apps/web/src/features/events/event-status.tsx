import type { EventStatus } from "@goliveboard/contracts";

import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

export const STATUS_LABELS: Readonly<Record<EventStatus, string>> = {
  DRAFT: "Draft",
  CONFIGURING: "Configuring",
  READY: "Ready",
  LIVE: "Live",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  CANCELLED: "Cancelled",
};

export const STATUSES = Object.keys(STATUS_LABELS) as EventStatus[];

/**
 * Status colours (docs/design/ui-direction.md): amber while being prepared,
 * green when ready, broadcast red only while live, grey otherwise.
 */
export const STATUS_STYLES: Readonly<Record<EventStatus, string>> = {
  DRAFT: "border-border bg-background text-muted-foreground",
  CONFIGURING: "border-transparent bg-warning-soft text-warning",
  READY: "border-transparent bg-success-soft text-success",
  LIVE: "border-transparent bg-live text-live-foreground",
  COMPLETED: "border-transparent bg-secondary text-secondary-foreground",
  ARCHIVED: "border-border bg-background text-subtle-foreground",
  CANCELLED: "border-border bg-background text-subtle-foreground",
};

/** The status as text in a badge: colour is never the only signal. */
export function EventStatusBadge({
  status,
}: Readonly<{ status: EventStatus }>) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-semibold", STATUS_STYLES[status])}
    >
      {status === "LIVE" ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-live-foreground motion-safe:animate-pulse"
        />
      ) : null}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** The label of the button that moves an event from `from` to `to`. */
export function transitionLabel(from: EventStatus, to: EventStatus): string {
  switch (to) {
    case "CONFIGURING":
      return from === "DRAFT" ? "Start configuring" : "Back to configuring";
    case "READY":
      return "Mark ready";
    case "LIVE":
      return "Go live";
    case "COMPLETED":
      return "Complete event";
    case "ARCHIVED":
      return "Archive";
    case "CANCELLED":
      return "Cancel event";
    case "DRAFT":
      return "Back to draft";
    default:
      return to satisfies never;
  }
}
