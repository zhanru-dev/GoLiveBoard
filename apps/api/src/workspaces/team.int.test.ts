import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  Invitation,
  InvitationPreview,
  Member,
  ProblemDetails,
  Workspace,
} from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiClient,
  TEST_PASSWORD,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import {
  blockWrites,
  createTestDatabase,
  type TestDatabase,
} from "../testing/database.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import type { Actor } from "../auth/actor.js";
import { INVITATION_TTL_MS } from "./invitations.service.js";
import { MembersService } from "./members.service.js";

const problemCode = (body: unknown) => ProblemDetails.parse(body).code;

describe("workspace and team", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();
  const clock = new TestClock();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.url },
      mailer,
      clock,
    });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  async function invite(owner: TestSession, email: string, role = "ANALYST") {
    const response = await api.send(owner, "post", "/workspace/invitations", {
      email,
      role,
    });
    expect(response.status).toBe(201);
    const [message] = mailer.to(email).slice(-1);
    return {
      invitation: Invitation.parse(response.body),
      token: tokenFromEmail(message?.text ?? ""),
    };
  }

  /** An owner plus a member who joined through an invitation, both signed in. */
  async function teamWith(role: "MANAGER" | "ANALYST" | "OWNER") {
    const owner = await api.newOwner();
    const email = uniqueEmail(role.toLowerCase());
    const { token } = await invite(owner, email, role);
    await api.post("/team-invitations/accept", {
      token,
      name: "Grace Hopper",
      password: TEST_PASSWORD,
    });
    const member = await api.session(email);
    const members = z
      .array(Member)
      .parse((await api.get(owner, "/workspace/members")).body);
    const membershipId =
      members.find((m) => m.email === email)?.membershipId ?? "";
    return { owner, member, membershipId };
  }

  describe("invitations (FR-WS-2)", () => {
    it("lets a new person join with a name and password from the emailed link", async () => {
      const owner = await api.newOwner();
      const email = uniqueEmail("invitee");
      const { token } = await invite(owner, email, "MANAGER");

      const preview = await api.post("/team-invitations/preview", { token });
      expect(InvitationPreview.parse(preview.body)).toMatchObject({
        email,
        role: "MANAGER",
        accountExists: false,
      });

      const accepted = await api.post("/team-invitations/accept", {
        token,
        name: "Grace Hopper",
        password: TEST_PASSWORD,
      });
      expect(accepted.status).toBe(204);
      const invitee = await api.session(email);
      const ownerWorkspace = await api.me(owner);
      expect((await api.me(invitee)).memberships).toContainEqual({
        workspaceId: ownerWorkspace.activeWorkspace.workspaceId,
        workspaceName: ownerWorkspace.activeWorkspace.workspaceName,
        role: "MANAGER",
        isDemo: false,
      });
    });

    it("links an existing account without asking for a password", async () => {
      const owner = await api.newOwner();
      const existing = await api.newOwner("existing");
      const { token } = await invite(owner, existing.email);

      const preview = InvitationPreview.parse(
        (await api.post("/team-invitations/preview", { token })).body,
      );
      expect(preview.accountExists).toBe(true);
      expect(
        (await api.post("/team-invitations/accept", { token })).status,
      ).toBe(204);

      expect((await api.me(existing)).memberships).toHaveLength(2);
    });

    it("asks a new person for a name and password", async () => {
      const owner = await api.newOwner();
      const { token } = await invite(owner, uniqueEmail());

      const response = await api.post("/team-invitations/accept", { token });

      expect(response.status).toBe(400);
      expect(problemCode(response.body)).toBe("VALIDATION_FAILED");
    });

    it.each([
      [
        "used",
        async (token: string) => {
          await api.post("/team-invitations/accept", {
            token,
            name: "Grace",
            password: TEST_PASSWORD,
          });
        },
      ],
      [
        "expired",
        () => {
          clock.advance(INVITATION_TTL_MS + 1);
          return Promise.resolve();
        },
      ],
    ])("rejects a %s link", async (_case, spoil) => {
      const owner = await api.newOwner();
      const { token } = await invite(owner, uniqueEmail());
      await spoil(token);

      const response = await api.post("/team-invitations/accept", {
        token,
        name: "Grace",
        password: TEST_PASSWORD,
      });

      expect(response.status).toBe(400);
      expect(problemCode(response.body)).toBe("TOKEN_INVALID");
    });

    it("rejects a revoked link, and only the newest link for an address works", async () => {
      const owner = await api.newOwner();
      const email = uniqueEmail();
      const first = await invite(owner, email);
      const second = await invite(owner, email);

      expect(
        problemCode(
          (await api.post("/team-invitations/preview", { token: first.token }))
            .body,
        ),
      ).toBe("TOKEN_INVALID");
      await api.send(
        owner,
        "delete",
        `/workspace/invitations/${second.invitation.id}`,
      );
      expect(
        problemCode(
          (await api.post("/team-invitations/preview", { token: second.token }))
            .body,
        ),
      ).toBe("TOKEN_INVALID");
    });

    it("leaves exactly one working link when an address is invited many times at once", async () => {
      const owner = await api.newOwner();
      const email = uniqueEmail();
      const attempts = 8;
      const block = await blockWrites(database.url, "team_invitations");

      const pending = Promise.all(
        Array.from({ length: attempts }, (_, index) =>
          Promise.resolve(
            api.send(owner, "post", "/workspace/invitations", {
              email,
              role: index % 2 === 0 ? "OWNER" : "ANALYST",
            }),
          ),
        ),
      );
      // One holds the address's lock at its write; the rest wait for it.
      await block.waitForWaiters(attempts);
      await block.release();
      const responses = await pending;

      // Every request succeeds (they queue rather than fail), and only one
      // of the links sent works.
      expect(responses.map((response) => response.status)).toEqual(
        Array.from({ length: attempts }, () => 201),
      );
      const tokens = mailer
        .to(email)
        .map((message) => tokenFromEmail(message.text));
      expect(tokens).toHaveLength(attempts);
      const previews = await Promise.all(
        tokens.map((token) =>
          Promise.resolve(api.post("/team-invitations/preview", { token })),
        ),
      );
      expect(previews.filter((preview) => preview.status === 200)).toHaveLength(
        1,
      );
      const open = z
        .array(Invitation)
        .parse((await api.get(owner, "/workspace/invitations")).body)
        .filter((invitation) => invitation.email === email);
      expect(open).toHaveLength(1);
    });

    it("refuses to invite someone who is already a member", async () => {
      const owner = await api.newOwner();

      const response = await api.send(owner, "post", "/workspace/invitations", {
        email: owner.email.toUpperCase(),
        role: "ANALYST",
      });

      expect(response.status).toBe(409);
      expect(problemCode(response.body)).toBe("MEMBERSHIP_EXISTS");
    });
  });

  describe("roles", () => {
    it.each(["MANAGER", "ANALYST"] as const)(
      "does not let a %s invite or change roles",
      async (role) => {
        const { member, membershipId } = await teamWith(role);

        const inviteResponse = await api.send(
          member,
          "post",
          "/workspace/invitations",
          {
            email: uniqueEmail(),
            role: "ANALYST",
          },
        );
        const roleResponse = await api.send(
          member,
          "patch",
          `/workspace/members/${membershipId}`,
          { role: "OWNER" },
        );

        expect(inviteResponse.status).toBe(403);
        expect(roleResponse.status).toBe(403);
      },
    );

    it("lets every role see the member list", async () => {
      const { member } = await teamWith("ANALYST");

      const response = await api.get(member, "/workspace/members");

      expect(z.array(Member).parse(response.body)).toHaveLength(2);
    });

    it("applies a role change to the member's very next request (FR-WS-3)", async () => {
      const { owner, member, membershipId } = await teamWith("ANALYST");

      await api.send(owner, "patch", `/workspace/members/${membershipId}`, {
        role: "MANAGER",
      });

      expect((await api.me(member)).activeWorkspace.role).toBe("MANAGER");
    });

    it("never removes or demotes the last Owner", async () => {
      const owner = await api.newOwner();
      const [self] = z
        .array(Member)
        .parse((await api.get(owner, "/workspace/members")).body);

      const demote = await api.send(
        owner,
        "patch",
        `/workspace/members/${self?.membershipId ?? ""}`,
        {
          role: "MANAGER",
        },
      );
      const remove = await api.send(
        owner,
        "delete",
        `/workspace/members/${self?.membershipId ?? ""}`,
      );

      expect(problemCode(demote.body)).toBe("OWNER_REQUIRED");
      expect(problemCode(remove.body)).toBe("OWNER_REQUIRED");
    });

    it("keeps one Owner when two Owners demote each other at the same moment", async () => {
      const {
        owner,
        member: secondOwner,
        membershipId: secondId,
      } = await teamWith("OWNER");
      const members = z
        .array(Member)
        .parse((await api.get(owner, "/workspace/members")).body);
      const firstId =
        members.find((m) => m.email === owner.email)?.membershipId ?? "";

      const block = await blockWrites(database.url, "memberships");

      const pending = Promise.all([
        Promise.resolve(
          api.send(owner, "patch", `/workspace/members/${secondId}`, {
            role: "MANAGER",
          }),
        ),
        Promise.resolve(
          api.send(secondOwner, "patch", `/workspace/members/${firstId}`, {
            role: "MANAGER",
          }),
        ),
      ]);
      // Both passed their role checks as Owners. One holds the Owner rows
      // at its UPDATE; the other waits for those rows.
      await block.waitForWaiters(2);
      await block.release();
      const results = await pending;

      // The second sees it would remove the last Owner.
      expect(results.map((response) => response.status).sort()).toEqual([
        204, 409,
      ]);
      const after = z
        .array(Member)
        .parse((await api.get(owner, "/workspace/members")).body);
      expect(after.filter((m) => m.role === "OWNER")).toHaveLength(1);
    });

    it("serialises concurrent demotions in the database, past any role check", async () => {
      const {
        owner,
        member: secondOwner,
        membershipId: secondId,
      } = await teamWith("OWNER");
      const members = z
        .array(Member)
        .parse((await api.get(owner, "/workspace/members")).body);
      const firstId =
        members.find((m) => m.email === owner.email)?.membershipId ?? "";
      const workspaceId = (await api.me(owner)).activeWorkspace.workspaceId;
      const actorFor = (session: TestSession, userId: string): Actor => ({
        userId,
        sessionId: session.access,
        workspaceId,
        role: "OWNER",
        requestId: "test-request",
      });
      const service = app.get(MembersService);

      const block = await blockWrites(database.url, "memberships");

      // Both calls start as Owners, as two requests that passed their role
      // checks before either change committed, and overlap at the lock.
      const pending = Promise.allSettled([
        service.changeRole(
          actorFor(owner, members[0]?.userId ?? ""),
          secondId,
          "MANAGER",
        ),
        service.changeRole(
          actorFor(secondOwner, members[1]?.userId ?? ""),
          firstId,
          "MANAGER",
        ),
      ]);
      await block.waitForWaiters(2);
      await block.release();
      const outcomes = await pending;

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      expect(failure?.reason).toMatchObject({ code: "OWNER_REQUIRED" });
    });
  });

  describe("removing and signing out members (FR-AUTH-3)", () => {
    it("ends a removed member's session at once", async () => {
      const { owner, member, membershipId } = await teamWith("MANAGER");

      expect(
        (await api.send(owner, "delete", `/workspace/members/${membershipId}`))
          .status,
      ).toBe(204);

      expect((await api.get(member, "/me")).status).toBe(401);
    });

    it("lets an Owner sign a member out everywhere", async () => {
      const { owner, member, membershipId } = await teamWith("ANALYST");

      await api.send(
        owner,
        "post",
        `/workspace/members/${membershipId}/sign-out`,
      );

      expect((await api.get(member, "/me")).status).toBe(401);
    });
  });

  describe("workspace isolation (FR-WS-4)", () => {
    it("treats another workspace's membership as not found", async () => {
      const { membershipId } = await teamWith("ANALYST");
      const outsider = await api.newOwner("outsider");

      const responses = await Promise.all([
        api.send(outsider, "patch", `/workspace/members/${membershipId}`, {
          role: "OWNER",
        }),
        api.send(outsider, "delete", `/workspace/members/${membershipId}`),
        api.send(
          outsider,
          "post",
          `/workspace/members/${membershipId}/sign-out`,
        ),
      ]);

      expect(responses.map((response) => response.status)).toEqual([
        404, 404, 404,
      ]);
    });

    it("never lists another workspace's members", async () => {
      const team = await teamWith("ANALYST");
      const outsider = await api.newOwner("outsider");

      const members = z
        .array(Member)
        .parse((await api.get(outsider, "/workspace/members")).body);

      expect(members.map((m) => m.email)).toEqual([outsider.email]);
      expect(members.map((m) => m.email)).not.toContain(team.member.email);
    });

    it("switches the active workspace, and only to one the user belongs to", async () => {
      const owner = await api.newOwner();
      const existing = await api.newOwner("existing");
      const { token } = await invite(owner, existing.email);
      await api.post("/team-invitations/accept", { token });
      const target = (await api.me(owner)).activeWorkspace.workspaceId;

      const switched = await api.send(existing, "put", "/me/active-workspace", {
        workspaceId: target,
      });
      expect(switched.status).toBe(200);
      expect(
        Workspace.parse((await api.get(existing, "/workspace")).body).id,
      ).toBe(target);

      const stranger = await api.newOwner("stranger");
      const refused = await api.send(stranger, "put", "/me/active-workspace", {
        workspaceId: target,
      });
      expect(refused.status).toBe(404);
    });

    it("refuses a request meant for the workspace the session has left", async () => {
      const owner = await api.newOwner();
      const existing = await api.newOwner("existing");
      const { token } = await invite(owner, existing.email);
      await api.post("/team-invitations/accept", { token });
      const own = (await api.me(existing)).activeWorkspace.workspaceId;
      const target = (await api.me(owner)).activeWorkspace.workspaceId;
      await api.send(existing, "put", "/me/active-workspace", {
        workspaceId: target,
      });

      // A page still showing the old workspace, or a request that crossed
      // the switch, names the old workspace and gets nothing from the new one.
      const stale = await api
        .get(existing, "/workspace/members")
        .set("X-Workspace-Id", own);
      const current = await api
        .get(existing, "/workspace/members")
        .set("X-Workspace-Id", target);

      expect(stale.status).toBe(409);
      expect(problemCode(stale.body)).toBe("WORKSPACE_CHANGED");
      expect(stale.body).not.toHaveProperty("0");
      expect(current.status).toBe(200);
    });
  });

  describe("workspace settings", () => {
    it("lets the Owner rename the workspace and change the retention period", async () => {
      const owner = await api.newOwner();

      const response = await api.send(owner, "patch", "/workspace", {
        name: "Acme Events",
        retentionDays: 180,
      });

      expect(Workspace.parse(response.body)).toMatchObject({
        name: "Acme Events",
        retentionDays: 180,
      });
    });

    it("refuses a Manager", async () => {
      const { member } = await teamWith("MANAGER");

      expect(
        (await api.send(member, "patch", "/workspace", { name: "Mine" }))
          .status,
      ).toBe(403);
    });
  });
});
