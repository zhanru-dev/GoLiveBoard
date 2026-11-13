/**
 * Query keys for events. They start with the workspace, like every other
 * key, so a workspace switch can never show one workspace's cached events
 * under another's name.
 */
export const eventKeys = {
  all: (workspaceId: string) => ["workspace", workspaceId, "events"] as const,
  list: (workspaceId: string, filters: object) =>
    [...eventKeys.all(workspaceId), "list", filters] as const,
  detail: (workspaceId: string, eventId: string) =>
    [...eventKeys.all(workspaceId), "detail", eventId] as const,
  readiness: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "readiness"] as const,
  runbook: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "runbook"] as const,
  accessPolicy: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "access-policy"] as const,
  streamChecks: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "stream-checks"] as const,
  incidents: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "incidents"] as const,
  holdingSlate: (workspaceId: string, eventId: string) =>
    [...eventKeys.detail(workspaceId, eventId), "holding-slate"] as const,
};
