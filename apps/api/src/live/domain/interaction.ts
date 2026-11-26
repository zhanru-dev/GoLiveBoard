import type { EventStatus } from "@goliveboard/contracts";

/**
 * When an event's chat and Q&A take new messages, questions and votes: from
 * when it is being prepared (attendees can ask ahead) until it ends.
 */
export function isInteractionOpen(status: EventStatus): boolean {
  return status === "CONFIGURING" || status === "READY" || status === "LIVE";
}

/** When they can still be read: also after the event, until it is archived. */
export function isInteractionReadable(status: EventStatus): boolean {
  return isInteractionOpen(status) || status === "COMPLETED";
}
