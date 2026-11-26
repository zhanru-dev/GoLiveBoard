import type { EventStatus } from "@goliveboard/contracts";

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

const VARIANTS: Readonly<
  Record<EventStatus, "default" | "secondary" | "destructive" | "outline">
> = {
  DRAFT: "outline",
  CONFIGURING: "secondary",
  READY: "default",
  LIVE: "destructive",
  COMPLETED: "secondary",
  ARCHIVED: "outline",
  CANCELLED: "outline",
};

/** The status as text in a badge: colour is never the only signal. */
export function EventStatusBadge({
  status,
}: Readonly<{ status: EventStatus }>) {
  return <Badge variant={VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
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
