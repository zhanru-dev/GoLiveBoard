export const integrationKeys = {
  workspace: (workspaceId: string) => ["workspace", workspaceId] as const,
  endpoints: (workspaceId: string) =>
    ["webhook-endpoints", workspaceId] as const,
  deliveries: (workspaceId: string, endpointId: string) =>
    ["webhook-deliveries", workspaceId, endpointId] as const,
};

/** What each webhook type means, for the subscription checkboxes. */
export const EVENT_TYPE_LABELS = {
  "event.ready": "An event is ready",
  "event.live": "An event goes live",
  "event.completed": "An event completes",
  "event.cancelled": "An event is cancelled",
  "attendee.registered": "An attendee confirms their registration",
} as const;
