import type { EventReport } from "@goliveboard/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { ReportPage } from "./report-page";

const EVENT_ID = "0195f0a0-0000-7000-8000-0000000000e0";

const REPORT: EventReport = {
  event: {
    id: EVENT_ID,
    slug: "launch-ab12",
    title: "Launch",
    status: "COMPLETED",
    startsAt: "2026-12-01T17:00:00.000Z",
    endsAt: "2026-12-01T17:03:00.000Z",
    timeZone: "Europe/London",
  },
  generatedAt: "2026-12-01T17:03:05.000Z",
  funnel: { registered: 5, verified: 4, attended: 3 },
  audience: {
    peak: 3,
    average: 2.3,
    series: [
      {
        minute: "2026-12-01T17:00:00.000Z",
        viewers: 3,
        messages: 2,
        incident: false,
      },
      {
        minute: "2026-12-01T17:01:00.000Z",
        viewers: 2,
        messages: 0,
        incident: true,
      },
      {
        minute: "2026-12-01T17:02:00.000Z",
        viewers: 2,
        messages: 1,
        incident: false,
      },
    ],
  },
  incidents: [
    {
      id: "0195f0a0-0000-7000-8000-0000000000e1",
      kind: "STREAM_UNREACHABLE",
      openedAt: "2026-12-01T17:01:10.000Z",
      resolvedAt: "2026-12-01T17:01:50.000Z",
    },
  ],
  questions: { asked: 4, answered: 1 },
  chat: { messages: 3 },
};

function figure(section: string, term: string) {
  const region = screen.getByRole("heading", { name: section }).parentElement;
  const label = within(region ?? document.body).getByText(term);
  return label.nextElementSibling?.textContent;
}

describe("ReportPage", () => {
  it("shows the funnel, the audience, the interaction and the incidents", async () => {
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}/report`, () =>
        HttpResponse.json(REPORT),
      ),
    );
    renderScreen(<ReportPage eventId={EVENT_ID} />, OWNER);

    expect(
      await screen.findByRole("heading", { name: "Report: Launch" }),
    ).toBeInTheDocument();
    expect(figure("Registration", "Registered")).toBe("5");
    expect(figure("Registration", "Confirmed their address")).toBe("4(80%)");
    expect(figure("Registration", "Attended")).toBe("3(60%)");
    expect(figure("Audience", "Peak")).toBe("3");
    expect(figure("Audience", "Average")).toBe("2.3");
    expect(figure("Interaction", "Questions answered")).toBe("1(25%)");
    expect(figure("Interaction", "Chat messages")).toBe("3");
    expect(
      screen.getByRole("img", {
        name: "Viewers per minute, with incidents shaded",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("incident-minute")).toHaveLength(1);
    expect(
      screen.getByText("Stream unreachable from 17:01 to 17:01"),
    ).toBeInTheDocument();
  });

  it("explains that a report comes once the event has completed", async () => {
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}/report`, () =>
        HttpResponse.json(problem(409, "REPORT_NOT_AVAILABLE"), {
          status: 409,
        }),
      ),
    );
    renderScreen(<ReportPage eventId={EVENT_ID} />, OWNER);

    expect(await screen.findByText("No report yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Report",
    );
    expect(
      screen.getByText("An event has a report once it has completed."),
    ).toBeInTheDocument();
  });

  it("downloads the CSV under the event's name", async () => {
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}/report`, () =>
        HttpResponse.json(REPORT),
      ),
      http.get(
        `*/api/v1/events/${EVENT_ID}/report.csv`,
        () =>
          new HttpResponse("metric,value\r\n", {
            headers: { "content-type": "text/csv" },
          }),
      ),
    );
    const created = vi.fn((blob: Blob) => {
      saved.push(blob);
      return "blob:report";
    });
    const saved: Blob[] = [];
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    const clicked: string[] = [];
    renderScreen(<ReportPage eventId={EVENT_ID} />, OWNER);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Download CSV" }));

    await expect.poll(() => clicked).toEqual(["report-launch-ab12.csv"]);
    expect(await saved[0]?.text()).toBe("metric,value\r\n");
    click.mockRestore();
  });
});
