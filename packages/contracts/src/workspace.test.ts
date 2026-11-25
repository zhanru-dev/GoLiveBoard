import { describe, expect, it } from "vitest";

import {
  AcceptInvitationRequest,
  UpdateWorkspaceRequest,
} from "./workspace.js";

describe("UpdateWorkspaceRequest", () => {
  it("accepts a partial change", () => {
    expect(UpdateWorkspaceRequest.parse({ retentionDays: 90 })).toEqual({
      retentionDays: 90,
    });
  });

  it("rejects an empty change", () => {
    expect(UpdateWorkspaceRequest.safeParse({}).success).toBe(false);
  });

  it.each([29, 731, 90.5])("rejects a retention period of %s days", (days) => {
    expect(
      UpdateWorkspaceRequest.safeParse({ retentionDays: days }).success,
    ).toBe(false);
  });
});

describe("AcceptInvitationRequest", () => {
  it("allows accepting with only the token, for existing accounts", () => {
    expect(AcceptInvitationRequest.safeParse({ token: "abc" }).success).toBe(
      true,
    );
  });

  it("applies the password rules when a password is given", () => {
    expect(
      AcceptInvitationRequest.safeParse({ token: "abc", password: "short" })
        .success,
    ).toBe(false);
  });
});
