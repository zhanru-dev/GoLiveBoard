import type { EventPage } from "@opspilot/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { anEvent, ANALYST, problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { EventsPage } from "./events-page";

function serveEvents(pages: Record<string, EventPage>) {
  const requests: URL[] = [];
  server.use(
    http.get("*/api/v1/events", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(pages[url.searchParams.get("cursor") ?? ""]);
    }),
  );
  return requests;
}

describe("EventsPage", () => {
  it("lists events with their status and start in the event's time zone", async () => {
    serveEvents({
      "": {
        items: [anEvent({ startsAt: "2026-07-01T17:00:00.000Z" })],
        nextCursor: null,
      },
    });
    renderScreen(<EventsPage />, OWNER);

    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    expect(
      await screen.findByRole("link", { name: "Product launch" }),
    ).toHaveAttribute("href", `/events/${anEvent().id}`);
    expect(
      screen.getByRole("cell", { name: "Configuring" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wed, 1 Jul 2026, 18:00 BST")).toBeInTheDocument();
  });

  it("loads the next page with the cursor", async () => {
    serveEvents({
      "": { items: [anEvent({ title: "First" })], nextCursor: "c1" },
      c1: {
        items: [
          anEvent({
            id: "0195f0a0-0000-7000-8000-0000000000e2",
            title: "Second",
          }),
        ],
        nextCursor: null,
      },
    });
    renderScreen(<EventsPage />, OWNER);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(
      await screen.findByRole("link", { name: "Second" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "First" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("searches and filters by status", async () => {
    const requests = serveEvents({ "": { items: [], nextCursor: null } });
    renderScreen(<EventsPage />, OWNER);
    const user = userEvent.setup();

    expect(
      await screen.findByText(
        "No events yet. Create one to start preparing it.",
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search titles"), "launch");
    await user.selectOptions(screen.getByLabelText("Status"), "READY");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("No events match these filters."),
    ).toBeInTheDocument();
    const last = requests.at(-1);
    expect(last?.searchParams.get("q")).toBe("launch");
    expect(last?.searchParams.get("status")).toBe("READY");
  });

  it("says when the events cannot be loaded", async () => {
    server.use(
      http.get("*/api/v1/events", () =>
        HttpResponse.json(problem(500, "INTERNAL_ERROR"), { status: 500 }),
      ),
    );
    renderScreen(<EventsPage />, OWNER);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the events.",
    );
  });

  it("offers New event to Managers and Owners, not Analysts", () => {
    serveEvents({ "": { items: [], nextCursor: null } });
    const { unmount } = renderScreen(<EventsPage />, OWNER);
    expect(screen.getByRole("link", { name: "New event" })).toBeInTheDocument();
    unmount();

    renderScreen(<EventsPage />, ANALYST);
    expect(
      screen.queryByRole("link", { name: "New event" }),
    ).not.toBeInTheDocument();
  });
});
