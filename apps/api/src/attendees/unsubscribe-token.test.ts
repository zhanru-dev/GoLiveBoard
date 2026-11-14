import { describe, expect, it } from "vitest";

import {
  attendeeOfUnsubscribeToken,
  unsubscribeToken,
} from "./unsubscribe-token.js";

const SECRET = "a-test-secret-of-sufficient-length-1234";
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
    const mac = genuine.slice(genuine.indexOf(".") + 1);

    for (const token of [
      `${OTHER}.${mac}`,
      unsubscribeToken("another-secret-of-sufficient-length-99", ATTENDEE),
      ATTENDEE,
      `.${mac}`,
      `${ATTENDEE}.`,
      `${ATTENDEE}.${mac.slice(0, -2)}`,
    ]) {
      expect(attendeeOfUnsubscribeToken(SECRET, token), token).toBeUndefined();
    }
  });
});
