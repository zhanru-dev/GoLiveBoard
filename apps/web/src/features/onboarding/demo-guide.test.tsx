import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { DemoGuide } from "./demo-guide";
import { PUBLIC, remember } from "./visits";

const DEMO = {
  ...OWNER,
  activeWorkspace: { ...OWNER.activeWorkspace, isDemo: true },
};
const event = (id: string, slug: string, status: string) => ({
  id,
  slug,
  title: slug,
  status,
  startsAt: "2026-11-29T15:00:00.000Z",
  endsAt: "2026-11-29T16:30:00.000Z",
  timeZone: "Europe/London",
  owner: null,
});

describe("DemoGuide", () => {
  beforeEach(() => {
    window.localStorage.clear();
    server.use(
      http.get("*/api/v1/events", () =>
        HttpResponse.json({
          items: [
            event(
              "0195f0a0-0000-7000-8000-0000000000e1",
              "autumn",
              "CONFIGURING",
            ),
            event(
              "0195f0a0-0000-7000-8000-0000000000e2",
              "conference",
              "COMPLETED",
            ),
          ],
          nextCursor: null,
        }),
      ),
    );
  });

  it("leads to the seeded events, and ticks a step once it is done", async () => {
    renderScreen(<DemoGuide />, DEMO);

    // Before the events load, the steps lead to the list; then to the seed.
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Open the report" }),
      ).toHaveAttribute(
        "href",
        "/events/0195f0a0-0000-7000-8000-0000000000e2/report",
      );
    });
    expect(screen.getByText("0 of 5")).toBeInTheDocument();

    act(() => {
      remember(PUBLIC, "registered");
    });
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
    expect(screen.getByText("Done:")).toBeInTheDocument();
  });
});
