import type { WorkspaceOverview } from "@goliveboard/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { OverviewPage } from "./overview-page";

const LAUNCH = "0195f0a0-0000-7000-8000-0000000000e1";

const OVERVIEW: WorkspaceOverview = {
  from: "2025-12-01",
  to: "2026-11-27",
  totals: {
    events: 2,
    registered: 4,
    verified: 3,
    attended: 3,
    questionsAsked: 4,
    questionsAnswered: 1,
    chatMessages: 9,
    incidents: 1,
    peakAudience: 2,
    averagePeak: 1.5,
  },
  months: [
    {
      month: "2026-10",
      events: 1,
      registered: 3,
      attended: 2,
      questionsAsked: 2,
    },
    {
      month: "2026-11",
      events: 1,
      registered: 1,
      attended: 1,
      questionsAsked: 2,
    },
  ],
  events: [
    {
      id: LAUNCH,
      title: "Product launch",
      startsAt: "2026-11-02T18:00:00.000Z",
      registered: 1,
      verified: 1,
      attended: 1,
      peakAudience: 1,
      questionsAsked: 2,
      questionsAnswered: 0,
      chatMessages: 0,
      incidents: 0,
    },
  ],
};

/** Serves the overview, and records the query of every request for it. */
function serve(overview: WorkspaceOverview = OVERVIEW): string[] {
  const queries: string[] = [];
  server.use(
    http.get("*/api/v1/reports/overview", ({ request }) => {
      queries.push(new URL(request.url).search);
      return HttpResponse.json(overview);
    }),
  );
  return queries;
}

describe("OverviewPage (FR-RC-4)", () => {
  it("shows the totals, the months and each event, linked to its report", async () => {
    serve();
    renderScreen(<OverviewPage />, OWNER);

    expect(
      await screen.findByText(/1 Dec 2025 – 27 Nov 2026: 2 completed events/),
    ).toBeVisible();
    const totals = screen.getByRole("region", { name: "In total" });
    expect(
      within(totals).getByText("Attended").closest("div"),
    ).toHaveTextContent("3(75%)");
    expect(
      screen.getByRole("img", { name: "Attendees per month" }),
    ).toBeVisible();
    const row = screen.getByRole("link", { name: "Product launch" });
    expect(row).toHaveAttribute("href", `/events/${LAUNCH}/report`);
    expect(
      within(row.closest("tr") ?? document.body).getByText("2 Nov 2026"),
    ).toBeVisible();
  });

  it("asks for the span chosen, and shows the span it has meanwhile", async () => {
    const queries = serve();
    renderScreen(<OverviewPage />, OWNER);
    const user = userEvent.setup();
    const from = await screen.findByLabelText("From");

    await expect
      .poll(() => (from as HTMLInputElement).value)
      .toBe("2025-12-01");
    await user.clear(from);
    await user.type(from, "2026-10-01");
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-10-31");
    await user.click(screen.getByRole("button", { name: "Show" }));

    await expect
      .poll(() => queries.at(-1))
      .toBe("?from=2026-10-01&to=2026-10-31");
    expect(queries[0]).toBe("");
  });

  it("does not ask for a span that ends before it starts", async () => {
    serve();
    renderScreen(<OverviewPage />, OWNER);
    const user = userEvent.setup();
    const to = await screen.findByLabelText("To");

    await expect.poll(() => (to as HTMLInputElement).value).toBe("2026-11-27");
    await user.clear(to);
    await user.type(to, "2025-01-01");

    expect(screen.getByRole("button", { name: "Show" })).toBeDisabled();
  });

  it("says so when no event completed in the span", async () => {
    serve({
      ...OVERVIEW,
      totals: { ...OVERVIEW.totals, events: 0 },
      events: [],
    });
    renderScreen(<OverviewPage />, OWNER);

    expect(
      await screen.findByText(/No event completed in this span/),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("downloads the CSV of the span on screen", async () => {
    serve();
    const requested: string[] = [];
    server.use(
      http.get("*/api/v1/reports/overview.csv", ({ request }) => {
        requested.push(new URL(request.url).search);
        return new HttpResponse("metric,value\r\n", {
          headers: { "content-type": "text/csv" },
        });
      }),
    );
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:overview"),
      revokeObjectURL: vi.fn(),
    });
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    renderScreen(<OverviewPage />, OWNER);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Download CSV" }));

    await expect
      .poll(() => clicked)
      .toEqual(["overview-2025-12-01-to-2026-11-27.csv"]);
    expect(requested).toEqual(["?from=2025-12-01&to=2026-11-27"]);
    click.mockRestore();
  });
});
