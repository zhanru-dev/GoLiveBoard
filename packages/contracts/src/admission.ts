import { z } from "zod";

import { Email, PersonName } from "./auth.js";
import { AccessMode } from "./launch-control.js";
import { PageQuery, pageOf } from "./pagination.js";

/**
 * What the public sees of an event's progress. Internal statuses
 * (CONFIGURING, READY…) are staff vocabulary and stay private.
 */
export const PublicEventStatus = z.enum([
  "UPCOMING",
  "LIVE",
  "ENDED",
  "CANCELLED",
]);
export type PublicEventStatus = z.infer<typeof PublicEventStatus>;

/** The public event page's data (FR-AD-1). No internal IDs. */
export const PublicEvent = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.string(),
  status: PublicEventStatus,
  registration: z.object({
    open: z.boolean(),
    /** Null while registration is closed. */
    mode: AccessMode.nullable(),
    /** The domains an EMAIL_DOMAIN event admits; empty otherwise. */
    allowedDomains: z.array(z.string()),
    /** The privacy notice the form shows and the registration records. */
    privacyNoticeVersion: z.string().nullable(),
  }),
});
export type PublicEvent = z.infer<typeof PublicEvent>;

/** FR-AD-3 and FR-AD-6: register with a name and email, after the notice. */
export const RegistrationRequest = z.object({
  name: PersonName,
  email: Email,
  /** The version of the notice shown; must be the event's current one. */
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  /** Agreement to the privacy notice is required. */
  consent: z.literal(true, {
    error: "Agree to the privacy notice to register",
  }),
  remindersOptIn: z.boolean(),
});
export type RegistrationRequest = z.infer<typeof RegistrationRequest>;

/** The token from a verification link (FR-AD-3). */
export const AttendeeVerificationRequest = z.object({
  token: z.string().min(1).max(200),
});
export type AttendeeVerificationRequest = z.infer<
  typeof AttendeeVerificationRequest
>;

export const AttendeeVerified = z.object({
  /** The event the attendee is now signed in to. */
  slug: z.string(),
});
export type AttendeeVerified = z.infer<typeof AttendeeVerified>;

/** The signed-in attendee's own registration. */
export const AttendeeMe = z.object({
  slug: z.string(),
  name: z.string(),
  remindersOptIn: z.boolean(),
});
export type AttendeeMe = z.infer<typeof AttendeeMe>;

/** The token from a reminder email's unsubscribe link (FR-AD-5). */
export const UnsubscribeRequest = z.object({
  token: z.string().min(1).max(200),
});
export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequest>;

/** Demo mode only: the mail this browser's registrations received. */
export const DemoInbox = z.object({
  messages: z.array(
    z.object({
      id: z.uuid(),
      subject: z.string(),
      text: z.string(),
      receivedAt: z.iso.datetime(),
    }),
  ),
});
export type DemoInbox = z.infer<typeof DemoInbox>;

export const AttendeeStatus = z.enum([
  "PENDING",
  "VERIFIED",
  "REVOKED",
  "ERASED",
]);
export type AttendeeStatus = z.infer<typeof AttendeeStatus>;

/**
 * An attendee as staff see them (docs/04, section 3.4). Analysts see the
 * address masked; an erased attendee has no address at all.
 */
export const StaffAttendee = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  status: AttendeeStatus,
  remindersOptIn: z.boolean(),
  registeredAt: z.iso.datetime(),
  verifiedAt: z.iso.datetime().nullable(),
});
export type StaffAttendee = z.infer<typeof StaffAttendee>;

export const AttendeePage = pageOf(StaffAttendee);
export type AttendeePage = z.infer<typeof AttendeePage>;

/** `?status=…` on top of the page parameters. */
export const AttendeeQuery = PageQuery.extend({
  status: AttendeeStatus.optional(),
});
export type AttendeeQuery = z.infer<typeof AttendeeQuery>;

/** An address invited to an invitation-only event (FR-AD-4). */
export const AttendeeInvitation = z.object({
  id: z.uuid(),
  email: z.string(),
  invitedAt: z.iso.datetime(),
});
export type AttendeeInvitation = z.infer<typeof AttendeeInvitation>;

export const CreateAttendeeInvitationRequest = z.object({ email: Email });
export type CreateAttendeeInvitationRequest = z.infer<
  typeof CreateAttendeeInvitationRequest
>;
