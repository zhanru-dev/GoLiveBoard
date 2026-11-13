import type { Role } from "@opspilot/contracts";

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  ANALYST: "Analyst",
};

export const ROLES: readonly Role[] = ["OWNER", "MANAGER", "ANALYST"];

export const teamKeys = {
  members: ["workspace", "members"] as const,
  invitations: ["workspace", "invitations"] as const,
};
