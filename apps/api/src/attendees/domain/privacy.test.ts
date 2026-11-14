import { describe, expect, it } from "vitest";

import {
  anonymisedEmail,
  attendeeSessionExpiresAt,
  retentionEndsAt,
  VERIFICATION_TTL_MS,
} from "./privacy.js";

describe("anonymisedEmail", () => {
  it("is a random placeholder that can never receive mail", () => {
    const random = "0123456789abcdef0123456789abcdef";
    expect(anonymisedEmail(random)).toBe(`${random}@anonymised.invalid`);
  });

  it.each(["", "abc", "0123456789ABCDEF0123456789ABCDEF", "ada@example.com"])(
    "refuses %j, which is not 16 random bytes in hex",
    (random) => {
      expect(() => anonymisedEmail(random)).toThrow();
    },
  );
});

describe("retentionEndsAt (FR-AD-6)", () => {
  it("is the event's end plus the retention period", () => {
    expect(
      retentionEndsAt(new Date("2026-12-01T19:00:00Z"), 90).toISOString(),
    ).toBe("2027-03-01T19:00:00.000Z");
  });
});

describe("attendeeSessionExpiresAt", () => {
  const ends = new Date("2026-12-01T19:00:00Z");

  it("lasts until a day after the event, for someone who verifies ahead", () => {
    expect(
      attendeeSessionExpiresAt(ends, new Date("2026-11-01T09:00:00Z")),
    ).toEqual(new Date("2026-12-02T19:00:00Z"));
  });

  it("lasts a day for someone who verifies after the event", () => {
    expect(
      attendeeSessionExpiresAt(ends, new Date("2026-12-05T09:00:00Z")),
    ).toEqual(new Date("2026-12-06T09:00:00Z"));
  });
});

describe("VERIFICATION_TTL_MS", () => {
  it("is 15 minutes (FR-AD-3)", () => {
    expect(VERIFICATION_TTL_MS).toBe(15 * 60 * 1000);
  });
});
