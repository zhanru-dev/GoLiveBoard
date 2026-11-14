import { z } from "zod";

import { Email, PersonName } from "./auth.js";
import { AccessMode } from "./launch-control.js";

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
