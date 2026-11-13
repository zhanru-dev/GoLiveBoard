import type { MailMessage } from "../mail/mailer.js";

/** Sent when someone signs up with a new address. */
export function welcomeEmail(
  to: string,
  name: string,
  appOrigin: string,
): MailMessage {
  return {
    to,
    subject: "Welcome to OpsPilot",
    text: [
      `Hi ${name},`,
      "",
      "Your OpsPilot workspace is ready. Sign in to prepare your first event:",
      `${appOrigin}/sign-in`,
    ].join("\n"),
  };
}

/**
 * Sent when someone signs up with an address that already has an account.
 * The sign-up response is the same either way; only the owner of the inbox
 * learns that the account exists (FR-WS-1, no account enumeration).
 */
export function accountExistsEmail(to: string, appOrigin: string): MailMessage {
  return {
    to,
    subject: "You already have an OpsPilot account",
    text: [
      "Someone, probably you, tried to sign up to OpsPilot with this email address.",
      "You already have an account. Sign in here:",
      `${appOrigin}/sign-in`,
      "",
      "Forgotten your password? Reset it from the sign-in page.",
      "If this was not you, you can ignore this email.",
    ].join("\n"),
  };
}

/**
 * Links carry their token in the URL fragment (after `#`), which browsers
 * never send to a server, so it cannot end up in proxy or server logs.
 */
function linkWithToken(appOrigin: string, path: string, token: string): string {
  return `${appOrigin}${path}#token=${token}`;
}

export function passwordResetEmail(
  to: string,
  token: string,
  appOrigin: string,
): MailMessage {
  return {
    to,
    subject: "Reset your OpsPilot password",
    text: [
      "Use this link to choose a new password. It works once, within 30 minutes:",
      linkWithToken(appOrigin, "/reset-password", token),
      "",
      "Resetting your password signs you out everywhere else.",
      "If you did not ask for this, you can ignore this email; your password stays the same.",
    ].join("\n"),
  };
}

export function invitationEmail(input: {
  readonly to: string;
  readonly workspaceName: string;
  readonly inviterName: string;
  readonly role: string;
  readonly token: string;
  readonly appOrigin: string;
}): MailMessage {
  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.workspaceName} on OpsPilot`,
    text: [
      `${input.inviterName} invited you to join ${input.workspaceName} as ${input.role.toLowerCase()}.`,
      "Accept within 7 days:",
      linkWithToken(input.appOrigin, "/invitations/accept", input.token),
    ].join("\n"),
  };
}
