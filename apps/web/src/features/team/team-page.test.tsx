import type { Invitation, Member } from "@opspilot/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { TeamPage } from "./team-page";

const members: Member[] = [
  {
    membershipId: "0195f0a0-0000-7000-8000-0000000000b1",
    userId: OWNER.user.id,
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "OWNER",
    joinedAt: "2026-11-13T09:00:00.000Z",
  },
  {
    membershipId: "0195f0a0-0000-7000-8000-0000000000b2",
    userId: "0195f0a0-0000-7000-8000-000000000002",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "ANALYST",
    joinedAt: "2026-11-13T10:00:00.000Z",
  },
];

function serveTeam(invitations: Invitation[] = []) {
  server.use(
    http.get("*/api/v1/workspace/members", () => HttpResponse.json(members)),
    http.get("*/api/v1/workspace/invitations", () =>
      HttpResponse.json(invitations),
    ),
  );
}

describe("TeamPage", () => {
  it("lists the members with their roles", async () => {
    serveTeam();
    renderScreen(<TeamPage />, OWNER);

    expect(
      await screen.findByRole("cell", { name: "Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Role of Grace Hopper" }),
    ).toHaveTextContent("Analyst");
  });

  it("lets an Owner invite someone", async () => {
    serveTeam();
    let sent: unknown;
    server.use(
      http.post("*/api/v1/workspace/invitations", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          {
            id: "0195f0a0-0000-7000-8000-0000000000c1",
            email: "linus@example.com",
            role: "ANALYST",
            expiresAt: "2026-11-20T09:00:00.000Z",
            createdAt: "2026-11-13T09:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );
    renderScreen(<TeamPage />, OWNER);
    const user = userEvent.setup();

    await user.type(
      await screen.findByLabelText("Email address"),
      "linus@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(sent).toEqual({ email: "linus@example.com", role: "ANALYST" });
  });

  it("shows an empty state when nobody is invited", async () => {
    serveTeam();
    renderScreen(<TeamPage />, OWNER);

    expect(
      await screen.findByText("No pending invitations."),
    ).toBeInTheDocument();
  });

  it("hides team management from an Analyst", async () => {
    serveTeam();
    renderScreen(<TeamPage />, {
      ...OWNER,
      activeWorkspace: { ...OWNER.activeWorkspace, role: "ANALYST" },
    });

    expect(
      await screen.findByRole("cell", { name: "Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send invitation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
