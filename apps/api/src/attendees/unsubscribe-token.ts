import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The token in a reminder email's unsubscribe link (FR-AD-5): the attendee's
 * ID and an HMAC of it. Nothing is stored, so every reminder can carry one,
 * and it works for as long as the attendee exists; only someone who has the
 * email can produce it. The key is derived from the server secret with a
 * purpose label, so it signs nothing else.
 */
const PURPOSE = "goliveboard:reminder-unsubscribe:";

/**
 * Between the ID and the MAC. A UUID never contains it, so the first one
 * splits the token, and every character stays URL-safe (base64url).
 */
const SEPARATOR = "_";

function mac(secret: string, attendeeId: string): Buffer {
  return createHmac("sha256", secret)
    .update(PURPOSE + attendeeId)
    .digest();
}

export function unsubscribeToken(secret: string, attendeeId: string): string {
  return `${attendeeId}${SEPARATOR}${mac(secret, attendeeId).toString("base64url")}`;
}

/** The attendee the token names, or `undefined` when it is not genuine. */
export function attendeeOfUnsubscribeToken(
  secret: string,
  token: string,
): string | undefined {
  const separator = token.indexOf(SEPARATOR);
  if (separator <= 0) {
    return undefined;
  }
  const attendeeId = token.slice(0, separator);
  const given = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = mac(secret, attendeeId);
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? attendeeId
    : undefined;
}
