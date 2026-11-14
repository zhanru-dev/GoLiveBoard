import type { MailMessage } from "../mail/mailer.js";

/**
 * Links carry their token in the URL fragment (after `#`), which browsers
 * never send to a server, so it cannot end up in proxy or server logs.
 */
function linkWithToken(appOrigin: string, path: string, token: string): string {
  return `${appOrigin}${path}#token=${token}`;
}

export function eventPageUrl(appOrigin: string, slug: string): string {
  return `${appOrigin}/e/${slug}`;
}

interface EventSummary {
  readonly slug: string;
  readonly title: string;
}

/** FR-AD-3: confirm the address; the link also signs them in. */
export function verificationEmail(
  to: string,
  event: EventSummary,
  token: string,
  appOrigin: string,
): MailMessage {
  return {
    to,
    subject: `Confirm your registration for ${event.title}`,
    text: [
      `Thanks for registering for ${event.title}.`,
      "Confirm your email address with this link. It works once, within 15 minutes:",
      linkWithToken(appOrigin, `/e/${event.slug}/verify`, token),
      "",
      "If you did not register, you can ignore this email.",
    ].join("\n"),
  };
}

/**
 * Someone registered again with an address that is already verified, for
 * example on another device: a fresh link signs them in there.
 */
export function signInLinkEmail(
  to: string,
  event: EventSummary,
  token: string,
  appOrigin: string,
): MailMessage {
  return {
    to,
    subject: `Your link to ${event.title}`,
    text: [
      `You are already registered for ${event.title}.`,
      "Use this link to join from this device. It works once, within 15 minutes:",
      linkWithToken(appOrigin, `/e/${event.slug}/verify`, token),
      "",
      "If you did not ask for this, you can ignore this email.",
    ].join("\n"),
  };
}

/** FR-AD-4: an invitation to an invitation-only event. */
export function invitationEmail(
  to: string,
  event: EventSummary,
  appOrigin: string,
): MailMessage {
  return {
    to,
    subject: `You're invited to ${event.title}`,
    text: [
      `You're invited to ${event.title}.`,
      "Register with this email address on the event page:",
      eventPageUrl(appOrigin, event.slug),
      "",
      "If you were not expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
