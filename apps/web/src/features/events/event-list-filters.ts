import type { EventStatus } from "@opspilot/contracts";

/** The list's search and status filter (FR-EV-3). */
export interface EventListFilters {
  readonly q?: string;
  readonly status?: EventStatus;
}
