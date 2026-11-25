import { z } from "zod";

import { Email, Password, PersonName, Role } from "./auth.js";

/** How long attendee personal data may be kept after an event (UK GDPR). */
export const RETENTION_DAYS_MIN = 30;
export const RETENTION_DAYS_MAX = 730;

export const Workspace = z.object({
  id: z.uuid(),
  name: z.string(),
  retentionDays: z.int(),
  /** Whether attendee.registered webhooks carry name and address. */
  webhooksIncludePersonalData: z.boolean(),
});
export type Workspace = z.infer<typeof Workspace>;

export const UpdateWorkspaceRequest = z
  .object({
    name: z.string().trim().min(1).max(100),
    retentionDays: z.int().min(RETENTION_DAYS_MIN).max(RETENTION_DAYS_MAX),
    webhooksIncludePersonalData: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: "Change at least one field",
  });
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

export const Member = z.object({
  membershipId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: Role,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof Member>;

export const UpdateMemberRequest = z.object({ role: Role });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const Invitation = z.object({
  id: z.uuid(),
  email: z.string(),
  role: Role,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof Invitation>;

export const CreateInvitationRequest = z.object({ email: Email, role: Role });
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

/** The token from an invitation link, sent in a body so it never appears in a URL log. */
export const InvitationTokenRequest = z.object({
  token: z.string().min(1).max(200),
});
export type InvitationTokenRequest = z.infer<typeof InvitationTokenRequest>;

/** What the accept page shows before the invitee confirms. */
export const InvitationPreview = z.object({
  workspaceName: z.string(),
  email: z.string(),
  role: Role,
  /** Whether the invitee must choose a name and password. */
  accountExists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

/** Name and password are required only when the invitee has no account yet. */
export const AcceptInvitationRequest = InvitationTokenRequest.extend({
  name: PersonName.optional(),
  password: Password.optional(),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

export const SwitchWorkspaceRequest = z.object({ workspaceId: z.uuid() });
export type SwitchWorkspaceRequest = z.infer<typeof SwitchWorkspaceRequest>;

export const PasswordResetRequest = z.object({ email: Email });
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

export const PasswordResetConfirmRequest = z.object({
  token: z.string().min(1).max(200),
  password: Password,
});
export type PasswordResetConfirmRequest = z.infer<
  typeof PasswordResetConfirmRequest
>;
