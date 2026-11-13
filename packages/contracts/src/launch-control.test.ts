import { describe, expect, it } from "vitest";

import {
  CreateRunbookTaskRequest,
  PutAccessPolicyRequest,
  UpdateRunbookTaskRequest,
} from "./launch-control.js";

describe("PutAccessPolicyRequest", () => {
  it("normalises and de-duplicates domains", () => {
    expect(
      PutAccessPolicyRequest.parse({
        mode: "EMAIL_DOMAIN",
        allowedDomains: [" Example.COM ", "example.com", "corp.example.co.uk"],
        privacyNoticeVersion: "2026-11",
      }).allowedDomains,
    ).toEqual(["example.com", "corp.example.co.uk"]);
  });

  it.each([
    ["EMAIL_DOMAIN without domains", "EMAIL_DOMAIN", []],
    ["PUBLIC with domains", "PUBLIC", ["example.com"]],
    ["INVITE_ONLY with domains", "INVITE_ONLY", ["example.com"]],
  ])("rejects %s", (_label, mode, allowedDomains) => {
    const result = PutAccessPolicyRequest.safeParse({
      mode,
      allowedDomains,
      privacyNoticeVersion: "v1",
    });

    expect(result.error?.issues[0]?.path).toEqual(["allowedDomains"]);
  });

  it.each(["localhost", "-bad.com", "exa mple.com", "@example.com", "a.b"])(
    "rejects the domain %j",
    (domain) => {
      expect(
        PutAccessPolicyRequest.safeParse({
          mode: "EMAIL_DOMAIN",
          allowedDomains: [domain],
          privacyNoticeVersion: "v1",
        }).success,
      ).toBe(false);
    },
  );
});

describe("runbook task requests", () => {
  it("creates an ordinary task by default", () => {
    expect(
      CreateRunbookTaskRequest.parse({ title: " Test the stream " }),
    ).toEqual({
      title: "Test the stream",
      isCritical: false,
      ownerUserId: null,
      dueAt: null,
    });
  });

  it("rejects an empty change", () => {
    expect(UpdateRunbookTaskRequest.safeParse({}).success).toBe(false);
  });
});
