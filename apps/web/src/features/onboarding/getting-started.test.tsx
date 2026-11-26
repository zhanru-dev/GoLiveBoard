import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { GettingStarted } from "./getting-started";

function serve({ events = [] as unknown[], members = 1 } = {}) {
  server.use(
    http.get("*/api/v1/events", () =>
      HttpResponse.json({ items: events, nextCursor: null }),
    ),
    http.get("*/api/v1/workspace/members", () =>
      HttpResponse.json(
        Array.from({ length: members }, (_, index) => ({
          membershipId: `0195f0a0-0000-7000-8000-00000000010${String(index)}`,
          userId: `0195f0a0-0000-7000-8000-00000000020${String(index)}`,
          name: `Person ${String(index)}`,
          email: `p${String(index)}@example.com`,
          role: index === 0 ? "OWNER" : "MANAGER",
          joinedAt: "2026-11-01T10:00:00.000Z",
        })),
      ),
    ),
    http.get("*/api/v1/webhook-endpoints", () => HttpResponse.json([])),
  );
}

describe("GettingStarted", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("walks a new Owner through every step, none done yet", async () => {
    serve();
    renderScreen(<GettingStarted />, OWNER);

    expect(
      await screen.findByRole("heading", {
        name: "Get started with GoLiveBoard",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 6 done")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create your first event" }),
    ).toHaveAttribute("href", "/events/new");
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute(
      "href",
      "/settings/team",
    );
  });

  it("stays hidden once hidden, in this browser", async () => {
    serve();
    const { unmount } = renderScreen(<GettingStarted />, OWNER);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Hide this list" }));
    expect(
      screen.queryByRole("heading", { name: "Get started with GoLiveBoard" }),
    ).toBeNull();
    unmount();

    renderScreen(<GettingStarted />, OWNER);
    // Give the queries time to answer: it must still not appear.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("heading", { name: "Get started with GoLiveBoard" }),
    ).toBeNull();
  });

  it("is not shown in the demo workspace, which has its own guide", async () => {
    serve();
    renderScreen(<GettingStarted />, {
      ...OWNER,
      activeWorkspace: { ...OWNER.activeWorkspace, isDemo: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("heading", { name: "Get started with GoLiveBoard" }),
    ).toBeNull();
  });
});
