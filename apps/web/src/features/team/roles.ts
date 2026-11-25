import type { Role } from "@opspilot/contracts";

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  ANALYST: "Analyst",
};

export const ROLES: readonly Role[] = ["OWNER", "MANAGER", "ANALYST"];

/**
 * Query keys for the active workspace's data. They include the workspace, so
 * one workspace's cached data can never be shown for another after a switch.
 */
export const teamKeys = {
  all: ["workspace"] as const,
  members: (workspaceId: string) =>
    ["workspace", workspaceId, "members"] as const,
  invitations: (workspaceId: string) =>
    ["workspace", workspaceId, "invitations"] as const,
};
