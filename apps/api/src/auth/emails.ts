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
