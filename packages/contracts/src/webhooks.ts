import { z } from "zod";

import { PageQuery, pageOf } from "./pagination.js";

/** What a webhook can be about (docs/04, section 6.2). */
export const WebhookEventType = z.enum([
  "event.ready",
  "event.live",
  "event.completed",
  "event.cancelled",
  "attendee.registered",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/** Where an Owner wants webhooks sent: https, no credentials in the URL. */
export const WebhookUrl = z
  .url({ protocol: /^https$/, error: "Enter an https:// URL" })
  .max(2048)
  .refine((value) => !/^https:\/\/[^/?#]*@/i.test(value), {
    error: "The URL must not contain a user name or password",
  });

export const WebhookEndpoint = z.object({
  id: z.uuid(),
  url: z.string(),
  eventTypes: z.array(WebhookEventType),
  description: z.string(),
  active: z.boolean(),
  /** Sent back in If-Match to change it. */
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;

const EventTypes = z
  .array(WebhookEventType)
  .min(1, { error: "Choose at least one event type" })
  .transform((types) => [...new Set(types)].sort());

export const CreateWebhookEndpointRequest = z.object({
  url: WebhookUrl,
  eventTypes: EventTypes,
  description: z.string().trim().max(200).default(""),
});
export type CreateWebhookEndpointRequest = z.infer<
  typeof CreateWebhookEndpointRequest
>;

export const UpdateWebhookEndpointRequest = z
  .object({
    url: WebhookUrl,
    eventTypes: EventTypes,
    description: z.string().trim().max(200),
    active: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: "Change at least one field",
  });
export type UpdateWebhookEndpointRequest = z.infer<
  typeof UpdateWebhookEndpointRequest
>;

/**
 * The signing secret, shown once: when the endpoint is created and when the
 * secret is rotated. It is never shown again.
 */
export const WebhookSecret = z.object({ secret: z.string() });
export type WebhookSecret = z.infer<typeof WebhookSecret>;

export const WebhookEndpointCreated = z.object({
  endpoint: WebhookEndpoint,
  secret: z.string(),
});
export type WebhookEndpointCreated = z.infer<typeof WebhookEndpointCreated>;

export const WebhookDeliveryStatus = z.enum(["PENDING", "SUCCEEDED", "FAILED"]);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>;

export const WebhookAttempt = z.object({
  attemptedAt: z.iso.datetime(),
  /** The receiver's status, if it answered. */
  statusCode: z.int().nullable(),
  durationMs: z.int(),
  error: z.string().nullable(),
});
export type WebhookAttempt = z.infer<typeof WebhookAttempt>;

export const WebhookDelivery = z.object({
  id: z.uuid(),
  endpointId: z.uuid(),
  /** The webhook's `id`, which receivers de-duplicate by. */
  eventId: z.uuid(),
  eventType: WebhookEventType,
  status: WebhookDeliveryStatus,
  /** Attempts in this round (a resend starts a new one). */
  attempts: z.int(),
  nextAttemptAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Every attempt, oldest first. */
  history: z.array(WebhookAttempt),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

export const WebhookDeliveryQuery = PageQuery.extend({
  endpointId: z.uuid().optional(),
  status: WebhookDeliveryStatus.optional(),
});
export type WebhookDeliveryQuery = z.infer<typeof WebhookDeliveryQuery>;

export const WebhookDeliveryPage = pageOf(WebhookDelivery);
export type WebhookDeliveryPage = z.infer<typeof WebhookDeliveryPage>;
