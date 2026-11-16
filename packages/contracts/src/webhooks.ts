import { z } from "zod";

/** What a webhook can be about (docs/04, section 6.2). */
export const WebhookEventType = z.enum([
  "event.ready",
  "event.live",
  "event.completed",
  "event.cancelled",
  "attendee.registered",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;
