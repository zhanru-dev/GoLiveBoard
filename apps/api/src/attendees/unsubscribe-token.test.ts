import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  attendeeOfUnsubscribeToken,
  unsubscribeToken,
} from "./unsubscribe-token.js";

// Made at run time: a literal would look like a leaked key to secret scanning.
const SECRET = randomBytes(32).toString("base64url");
const OTHER_SECRET = randomBytes(32).toString("base64url");
const ATTENDEE = "0193f2a4-0000-7b2a-9d1f-3e5c7a9b1d2f";
const OTHER = "0193f2a4-0000-7b2a-9d1f-3e5c7a9b1d30";

describe("unsubscribe tokens", () => {
  it("name the attendee they were made for", () => {
    expect(
      attendeeOfUnsubscribeToken(SECRET, unsubscribeToken(SECRET, ATTENDEE)),
    ).toBe(ATTENDEE);
  });

  it("refuse a token for another attendee, another secret or a broken one", () => {
    const genuine = unsubscribeToken(SECRET, ATTENDEE);
    const mac = genuine.slice(genuine.indexOf("_") + 1);

    for (const token of [
      `${OTHER}_${mac}`,
      unsubscribeToken(OTHER_SECRET, ATTENDEE),
      ATTENDEE,
      `_${mac}`,
      `${ATTENDEE}_`,
      `${ATTENDEE}_${mac.slice(0, -2)}`,
    ]) {
      expect(attendeeOfUnsubscribeToken(SECRET, token), token).toBeUndefined();
    }
  });
});
