import type { AuditEntry, Member } from "@goliveboard/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { AuditPage } from "./audit-page";

const GRACE: Member = {
  membershipId: "0195f0a0-0000-7000-8000-0000000000b2",
  userId: "0195f0a0-0000-7000-8000-000000000002",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "MANAGER",
  joinedAt: "2026-11-13T10:00:00.000Z",
};

function entry(id: string, changes: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    occurredAt: "2026-11-16T10:00:00.000Z",
    actor: { kind: "USER", userId: GRACE.userId, name: "Grace Hopper" },
    action: "event.transitioned",
    targetType: "event",
    targetId: "0195f0a0-0000-7000-8000-0000000000e0",
    eventId: "0195f0a0-0000-7000-8000-0000000000e0",
    before: { status: "DRAFT" },
    after: { status: "CONFIGURING" },
    requestId: "req-1",
    ...changes,
  };
}

const FIRST = "0195f0a0-0000-7000-8000-0000000000f1";
const SECOND = "0195f0a0-0000-7000-8000-0000000000f2";

describe("AuditPage", () => {
  it("lists who did what, with the change, and pages by cursor", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get("*/api/v1/workspace/members", () => HttpResponse.json([GRACE])),
      http.get("*/api/v1/audit-entries", ({ request }) => {
        const query = new URL(request.url).searchParams;
        queries.push(query);
        return query.get("cursor") === "next"
          ? HttpResponse.json({
              items: [
                entry(SECOND, {
                  actor: { kind: "SYSTEM", userId: null, name: null },
                  action: "attendee.anonymised",
                  before: null,
                  after: null,
                }),
              ],
              nextCursor: null,
            })
          : HttpResponse.json({ items: [entry(FIRST)], nextCursor: "next" });
      }),
    );
    renderScreen(<AuditPage />, OWNER);

    const row = (
      await screen.findByText("Grace Hopper", { selector: "td" })
    ).closest("tr");
    expect(row).toHaveTextContent("event.transitioned");
    expect(row).toHaveTextContent("status: DRAFT → CONFIGURING");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("GoLiveBoard")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(queries.map((query) => query.get("cursor"))).toEqual([null, "next"]);
  });

  it("searches by who, action and time", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get("*/api/v1/workspace/members", () => HttpResponse.json([GRACE])),
      http.get("*/api/v1/audit-entries", ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderScreen(<AuditPage />, OWNER);
    const user = userEvent.setup();
    const filters = screen.getByRole("form", { name: "Filters" });
    await screen.findByRole("option", { name: "Grace Hopper" });

    await user.selectOptions(
      within(filters).getByLabelText("Who"),
      "Grace Hopper",
    );
    await user.type(within(filters).getByLabelText("Action"), "event.created");
    await user.type(within(filters).getByLabelText("From"), "2026-11-16T09:00");
    await user.click(within(filters).getByRole("button", { name: "Search" }));

    await expect.poll(() => queries.length).toBe(2);
    const searched = queries[1];
    expect(searched?.get("actorId")).toBe(GRACE.userId);
    expect(searched?.get("action")).toBe("event.created");
    expect(searched?.get("from")).toBe(
      new Date("2026-11-16T09:00").toISOString(),
    );
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });

  it("shows the API's refusal of a search", async () => {
    server.use(
      http.get("*/api/v1/workspace/members", () => HttpResponse.json([])),
      http.get("*/api/v1/audit-entries", () =>
        HttpResponse.json(
          {
            ...problem(422, "VALIDATION_FAILED"),
            detail: "Must be after from",
          },
          { status: 422 },
        ),
      ),
    );
    renderScreen(<AuditPage />, OWNER);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Must be after from",
    );
  });
});
