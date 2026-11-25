import type { EventStatus, WebhookEventType } from "@opspilot/contracts";

/** The webhook an event's transition sends, if any (docs/04, section 6.2). */
export function webhookTypeForTransition(
  to: EventStatus,
): WebhookEventType | undefined {
  switch (to) {
    case "READY":
      return "event.ready";
    case "LIVE":
      return "event.live";
    case "COMPLETED":
      return "event.completed";
    case "CANCELLED":
      return "event.cancelled";
    case "DRAFT":
    case "CONFIGURING":
    case "ARCHIVED":
      return undefined;
    default:
      return to satisfies never;
  }
}
