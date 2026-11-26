import type { AttendeeStatus, EventStatus } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import {
  admitsAttendance,
  admitsRegistration,
  emailDomain,
  isPublic,
  isRegistrationOpen,
  type PolicyRules,
} from "./admission.js";

const PUBLIC: PolicyRules = { mode: "PUBLIC", allowedDomains: [] };
const DOMAINS: PolicyRules = {
  mode: "EMAIL_DOMAIN",
  allowedDomains: ["example.com", "partner.org"],
};
const INVITES: PolicyRules = { mode: "INVITE_ONLY", allowedDomains: [] };

const ALL_STATUSES: EventStatus[] = [
  "DRAFT",
  "CONFIGURING",
  "READY",
  "LIVE",
  "COMPLETED",
  "ARCHIVED",
  "CANCELLED",
];

const registration = (
  overrides: Partial<Parameters<typeof admitsRegistration>[0]> = {},
) => ({
  eventStatus: "READY" as EventStatus,
  policy: PUBLIC,
  email: "ada@example.com",
  invited: false,
  ...overrides,
});

describe("isPublic", () => {
  it("hides drafts and archived events, and shows the rest", () => {
    expect(ALL_STATUSES.filter(isPublic)).toEqual([
      "CONFIGURING",
      "READY",
      "LIVE",
      "COMPLETED",
      "CANCELLED",
    ]);
  });
});

describe("isRegistrationOpen", () => {
  it("is open from configuring until the event is live", () => {
    expect(ALL_STATUSES.filter(isRegistrationOpen)).toEqual([
      "CONFIGURING",
      "READY",
      "LIVE",
    ]);
  });
});

describe("emailDomain", () => {
  it("is the lower-cased part after the last @", () => {
    expect(emailDomain("Ada@Example.COM")).toBe("example.com");
    expect(emailDomain('"a@b"@partner.org')).toBe("partner.org");
  });
});

describe("admitsRegistration (FR-AD-2)", () => {
  it("admits anyone to a public event", () => {
    expect(admitsRegistration(registration())).toEqual({ admitted: true });
  });

  it("refuses every status in which registration is closed", () => {
    for (const eventStatus of ALL_STATUSES.filter(
      (status) => !isRegistrationOpen(status),
    )) {
      expect(admitsRegistration(registration({ eventStatus }))).toEqual({
        admitted: false,
        reason: "EVENT_CLOSED",
      });
    }
  });

  it("refuses an event without an access policy", () => {
    expect(admitsRegistration(registration({ policy: null }))).toEqual({
      admitted: false,
      reason: "NO_POLICY",
    });
  });

  it("admits listed domains exactly, whatever their case", () => {
    const check = (email: string) =>
      admitsRegistration(registration({ policy: DOMAINS, email })).admitted;

    expect(check("ada@Example.com")).toBe(true);
    expect(check("grace@partner.org")).toBe(true);
    expect(check("ada@mail.example.com")).toBe(false);
    expect(check("ada@example.com.evil.net")).toBe(false);
    expect(
      admitsRegistration(
        registration({ policy: DOMAINS, email: "ada@other.net" }),
      ),
    ).toEqual({ admitted: false, reason: "DOMAIN_NOT_ALLOWED" });
  });

  it("admits only invited addresses to an invitation-only event", () => {
    expect(
      admitsRegistration(registration({ policy: INVITES, invited: true })),
    ).toEqual({ admitted: true });
    expect(
      admitsRegistration(registration({ policy: INVITES, invited: false })),
    ).toEqual({ admitted: false, reason: "NOT_INVITED" });
  });

  it("ignores invitations for the other modes", () => {
    expect(
      admitsRegistration(
        registration({ policy: DOMAINS, email: "x@other.net", invited: true }),
      ).admitted,
    ).toBe(false);
  });
});

describe("admitsAttendance", () => {
  const attendance = (
    attendeeStatus: AttendeeStatus,
    overrides: Partial<Parameters<typeof admitsRegistration>[0]> = {},
  ) => admitsAttendance({ ...registration(overrides), attendeeStatus });

  it("admits a verified attendee", () => {
    expect(attendance("VERIFIED")).toEqual({ admitted: true });
  });

  it.each([
    ["PENDING", "NOT_VERIFIED"],
    ["REVOKED", "REVOKED"],
    ["ERASED", "ERASED"],
  ] as const)("refuses a %s attendee", (status, reason) => {
    expect(attendance(status)).toEqual({ admitted: false, reason });
  });

  it("keeps a verified attendee in after the event ends, but not once it is archived or cancelled", () => {
    expect(attendance("VERIFIED", { eventStatus: "COMPLETED" }).admitted).toBe(
      true,
    );
    for (const eventStatus of ["DRAFT", "ARCHIVED", "CANCELLED"] as const) {
      expect(attendance("VERIFIED", { eventStatus })).toEqual({
        admitted: false,
        reason: "EVENT_CLOSED",
      });
    }
  });

  it("applies the current policy: a changed policy or a revoked invitation takes effect at once", () => {
    expect(
      attendance("VERIFIED", { policy: DOMAINS, email: "ada@other.net" }),
    ).toEqual({ admitted: false, reason: "DOMAIN_NOT_ALLOWED" });
    expect(attendance("VERIFIED", { policy: INVITES, invited: false })).toEqual(
      { admitted: false, reason: "NOT_INVITED" },
    );
    expect(attendance("VERIFIED", { policy: null })).toEqual({
      admitted: false,
      reason: "NO_POLICY",
    });
  });
});
