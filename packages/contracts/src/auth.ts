import { z } from "zod";

/** Roles a staff member can hold in a workspace (docs/01, section 3). */
export const Role = z.enum(["OWNER", "MANAGER", "ANALYST"]);
export type Role = z.infer<typeof Role>;

/** RFC 5321 limits an address to 254 characters. */
const MAX_EMAIL_LENGTH = 254;
/**
 * Length is what makes a password strong (NCSC and NIST guidance); there are
 * no rules about character classes. The maximum only stops absurd inputs.
 */
export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 100;

export const Email = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH)
  .pipe(z.email({ error: "Enter a valid email address" }));

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  .max(PASSWORD_MAX_LENGTH);

export const PersonName = z.string().trim().min(1).max(NAME_MAX_LENGTH);

export const SignUpRequest = z.object({
  name: PersonName,
  email: Email,
  password: Password,
});
export type SignUpRequest = z.infer<typeof SignUpRequest>;

/**
 * Sign-in accepts any non-empty password: checking the length here would tell
 * an attacker something about the rules for free.
 */
export const SignInRequest = z.object({
  email: Email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignInRequest = z.infer<typeof SignInRequest>;

export const MembershipSummary = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  role: Role,
});
export type MembershipSummary = z.infer<typeof MembershipSummary>;

/** Body of `GET /me`, also returned by sign-in. */
export const Me = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  activeWorkspace: MembershipSummary,
  memberships: z.array(MembershipSummary),
});
export type Me = z.infer<typeof Me>;

/**
 * Body of `202` responses that must look the same whatever happened, so they
 * reveal nothing about which accounts exist (sign-up, password reset).
 */
export const Accepted = z.object({ status: z.literal("accepted") });
export type Accepted = z.infer<typeof Accepted>;
