import type { EventStatus } from "@goliveboard/contracts";

/** The stages an event moves through, in order (docs/03, section 2). */
export const STAGES = [
  "DRAFT",
  "CONFIGURING",
  "READY",
  "LIVE",
  "COMPLETED",
] as const satisfies readonly EventStatus[];

/**
 * What to do next, in words, for an event in `status` with `blockers` hard
 * blockers left (unknown while readiness loads).
 */
export function nextStep(status: EventStatus, blockers?: number): string {
  switch (status) {
    case "DRAFT":
      return "Start configuring when the details are right: Launch Control then scores the event.";
    case "CONFIGURING":
      if (blockers === undefined) {
        return "Clear the hard blockers, then mark the event ready.";
      }
      return blockers === 0
        ? "Every hard blocker passes: mark the event ready."
        : `Clear ${String(blockers)} hard ${blockers === 1 ? "blocker" : "blockers"}, then mark the event ready. Going live is refused until then.`;
    case "READY":
      return "Go live when the stream starts: attendees then see it instead of the holding slate.";
    case "LIVE":
      return "Follow viewers, chat and incidents in the ops room. Complete the event when it ends.";
    case "COMPLETED":
      return "Read the report: the audience over time, and any incidents.";
    case "ARCHIVED":
      return "Archived: nothing can change any more. The report stays available.";
    case "CANCELLED":
      return "Cancelled: nothing more to do.";
    default:
      return status satisfies never;
  }
}
