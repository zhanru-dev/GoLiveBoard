import type {
  AccessMode,
  AttendeeStatus,
  EventStatus,
} from "@opspilot/contracts";

/**
 * Whether an event has a public page. A draft is not announced yet, and an
 * archived event is gone from public view (FR-EV-4).
 */
export function isPublic(status: EventStatus): boolean {
  return status !== "DRAFT" && status !== "ARCHIVED";
}

/** Registration is open until the event has ended or been called off. */
export function isRegistrationOpen(status: EventStatus): boolean {
  return status === "CONFIGURING" || status === "READY" || status === "LIVE";
}

/**
 * A verified attendee keeps access to their event until it is archived or
 * cancelled: also after it ended, to see its page.
 */
function isAttendanceOpen(status: EventStatus): boolean {
  return isRegistrationOpen(status) || status === "COMPLETED";
}

/** Who an event admits (FR-AD-2), as stored in its access policy. */
export interface PolicyRules {
  readonly mode: AccessMode;
  /** Lower-case domains; only used for EMAIL_DOMAIN. */
  readonly allowedDomains: readonly string[];
}

/** Why someone is not admitted. Never shown to the public (no enumeration). */
export type Refusal =
  | "EVENT_CLOSED"
  | "NO_POLICY"
  | "DOMAIN_NOT_ALLOWED"
  | "NOT_INVITED"
  | "NOT_VERIFIED"
  | "REVOKED"
  | "ERASED";

export type Admission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: Refusal };

const ADMITTED: Admission = { admitted: true };
const refuse = (reason: Refusal): Admission => ({ admitted: false, reason });

/** The domain of an address, lower-case: what follows the last "@". */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * Whether the policy admits this address. `invited` says whether the event
 * has a live invitation for it; only INVITE_ONLY reads it. Domains match
 * exactly: a policy for `example.com` does not admit `mail.example.com`.
 */
function policyAdmits(
  policy: PolicyRules | null,
  email: string,
  invited: boolean,
): Admission {
  if (policy === null) {
    return refuse("NO_POLICY");
  }
  switch (policy.mode) {
    case "PUBLIC":
      return ADMITTED;
    case "EMAIL_DOMAIN":
      return policy.allowedDomains.includes(emailDomain(email))
        ? ADMITTED
        : refuse("DOMAIN_NOT_ALLOWED");
    case "INVITE_ONLY":
      return invited ? ADMITTED : refuse("NOT_INVITED");
    default:
      return policy.mode satisfies never;
  }
}

export interface RegistrationCheck {
  readonly eventStatus: EventStatus;
  readonly policy: PolicyRules | null;
  readonly email: string;
  readonly invited: boolean;
}

/** Whether an address may register for the event (FR-AD-2, FR-AD-3). */
export function admitsRegistration(check: RegistrationCheck): Admission {
  if (!isRegistrationOpen(check.eventStatus)) {
    return refuse("EVENT_CLOSED");
  }
  return policyAdmits(check.policy, check.email, check.invited);
}

export interface AttendanceCheck extends RegistrationCheck {
  readonly attendeeStatus: AttendeeStatus;
}

/**
 * Whether a registered attendee may use their session now: checked on every
 * attendee request, so revoking them, erasing them, or changing the policy
 * applies at once (FR-AD-2). The event's current policy decides, not the one
 * they registered under.
 */
export function admitsAttendance(check: AttendanceCheck): Admission {
  switch (check.attendeeStatus) {
    case "PENDING":
      return refuse("NOT_VERIFIED");
    case "REVOKED":
      return refuse("REVOKED");
    case "ERASED":
      return refuse("ERASED");
    case "VERIFIED":
      break;
    default:
      return check.attendeeStatus satisfies never;
  }
  if (!isAttendanceOpen(check.eventStatus)) {
    return refuse("EVENT_CLOSED");
  }
  return policyAdmits(check.policy, check.email, check.invited);
}
