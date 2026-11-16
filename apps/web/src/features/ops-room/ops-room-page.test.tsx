import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeEventSource } from "@/testing/event-source";
import { INCIDENT, ROOM } from "@/testing/ops-room";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { OpsRoomPage } from "./ops-room-page";

const EVENT_ID = ROOM.event.id;

describe("OpsRoomPage", () => {
  beforeEach(() => {
    FakeEventSource.install();
  });

  function show() {
    renderScreen(<OpsRoomPage eventId={EVENT_ID} />, OWNER);
    const source = FakeEventSource.last();
    act(() => {
      source.open();
      source.emit("snapshot", ROOM);
    });
    return source;
  }

  it("opens the event's stream with the session's cookies", () => {
    show();

    expect(FakeEventSource.last().url).toBe(
      `/api/v1/events/${EVENT_ID}/live-ops/stream`,
    );
    expect(FakeEventSource.last().init).toEqual({ withCredentials: true });
  });

  it("shows the room from the snapshot", () => {
    show();

    expect(
      screen.getByRole("heading", { name: "Operations room: Launch" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live");
    const figures = screen.getByRole("region", { name: "Figures" });
    expect(within(figures).getByText("Reachable")).toBeInTheDocument();
    expect(
      within(figures).getByText("80 ms, checked at 17:04"),
    ).toBeInTheDocument();
    expect(within(figures).getByText("Peak 3")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Viewers per minute" }),
    ).toBeInTheDocument();
    const timeline = screen
      .getByRole("heading", { name: "Timeline" })
      .parentElement?.querySelector("ol");
    expect(timeline).toHaveTextContent("17:00 Ready → Live");
  });

  it("announces an incident at once, and takes it away when resolved", () => {
    const source = show();
    const incidents = screen
      .getByRole("heading", { name: "Open incidents" })
      .parentElement?.querySelector("[aria-live]");
    expect(incidents).toHaveAttribute("aria-live", "assertive");

    act(() => {
      source.emit("incident.opened", INCIDENT);
    });
    expect(incidents).toHaveTextContent("Stream unreachable since 17:05");

    act(() => {
      source.emit("incident.resolved", {
        ...INCIDENT,
        resolvedAt: "2026-12-01T17:06:00.000Z",
      });
    });
    expect(incidents).toHaveTextContent("None.");
    expect(screen.getByText("Stream back")).toBeInTheDocument();
  });

  it("follows the figures as they arrive", () => {
    const source = show();

    act(() => {
      source.emit("rates.updated", {
        messagesPerMinute: 12,
        questionsPerMinute: 3,
      });
      source.emit("stream.status", {
        ok: false,
        checkedAt: "2026-12-01T17:07:00.000Z",
        latencyMs: 0,
      });
    });

    const figures = screen.getByRole("region", { name: "Figures" });
    expect(within(figures).getByText("12")).toBeInTheDocument();
    expect(within(figures).getByText("Unreachable")).toBeInTheDocument();
  });

  it("says so while the browser reconnects by itself", () => {
    const source = show();

    act(() => {
      source.fail();
    });

    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    expect(FakeEventSource.opened).toHaveLength(1);
  });

  it("refreshes the session and opens the stream again when it is refused", async () => {
    let refreshed = 0;
    server.use(
      http.post("*/api/v1/auth/refresh", () => {
        refreshed += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const source = show();

    act(() => {
      source.refuse();
    });

    await expect
      .poll(() => FakeEventSource.opened.length, { timeout: 4_000 })
      .toBe(2);
    expect(refreshed).toBe(1);
  });

  it("stops, and offers to try again, once signed out", async () => {
    server.use(
      http.post("*/api/v1/auth/refresh", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Unauthenticated",
            status: 401,
            code: "UNAUTHENTICATED",
          },
          { status: 401 },
        ),
      ),
    );
    const source = show();

    act(() => {
      source.refuse();
    });

    expect(
      await screen.findByText("The live updates stopped"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Disconnected");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(FakeEventSource.opened).toHaveLength(2);
  });
});
