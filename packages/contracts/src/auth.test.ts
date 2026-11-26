import { describe, expect, it } from "vitest";

import { Email, Password, SignInRequest, SignUpRequest } from "./auth.js";

describe("Email", () => {
  it.each(["manager@demo.goliveboard.invalid", "someone@EXAMPLE.INVALID"])(
    "refuses %j, an address that can never receive email",
    (email) => {
      expect(Email.safeParse(email).success).toBe(false);
    },
  );

  it("trims surrounding spaces and keeps the address as typed", () => {
    expect(Email.parse("  Ada@Example.com ")).toBe("Ada@Example.com");
  });

  it.each(["", "ada", "ada@", "@example.com", `${"a".repeat(250)}@x.io`])(
    "rejects %j",
    (value) => {
      expect(Email.safeParse(value).success).toBe(false);
    },
  );
});

describe("Password", () => {
  it("accepts a long passphrase without special characters", () => {
    expect(Password.safeParse("correct horse battery").success).toBe(true);
  });

  it("explains the minimum length", () => {
    const result = Password.safeParse("short");

    expect(result.error?.issues[0]?.message).toBe("Use at least 12 characters");
  });

  it("rejects absurdly long input", () => {
    expect(Password.safeParse("x".repeat(129)).success).toBe(false);
  });
});

describe("SignUpRequest", () => {
  it("requires a name", () => {
    expect(
      SignUpRequest.safeParse({
        name: "   ",
        email: "ada@example.com",
        password: "correct horse battery",
      }).success,
    ).toBe(false);
  });

  it("takes an optional invite code, trimmed, and refuses an empty one", () => {
    const base = {
      name: "Ada",
      email: "ada@example.com",
      password: "correct horse battery",
    };

    expect(SignUpRequest.parse(base).inviteCode).toBeUndefined();
    expect(
      SignUpRequest.parse({ ...base, inviteCode: " abc " }).inviteCode,
    ).toBe("abc");
    expect(SignUpRequest.safeParse({ ...base, inviteCode: "  " }).success).toBe(
      false,
    );
  });
});

describe("SignInRequest", () => {
  it("does not apply the password rules, so it reveals nothing about them", () => {
    expect(
      SignInRequest.safeParse({ email: "ada@example.com", password: "x" })
        .success,
    ).toBe(true);
  });
});
