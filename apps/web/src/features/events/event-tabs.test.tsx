import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventLifecycle } from "./event-lifecycle";
import { EventTabs } from "./event-tabs";

const EVENT = { id: "e1", slug: "launch-abc", status: "CONFIGURING" as const };

describe("EventTabs", () => {
  it("names each page plainly and describes what it is for", () => {
    render(<EventTabs event={EVENT} current="launch-control" />);
    const nav = screen.getByRole("navigation", { name: "Event pages" });

    const launch = within(nav).getByRole("link", { name: "Launch Control" });
    expect(launch).toHaveAttribute("aria-current", "page");
    expect(launch).toHaveAccessibleDescription("Prepare and check");
    expect(
      within(nav).getByRole("link", { name: "Operations room" }),
    ).toHaveAttribute("href", "/events/e1/live");
    const publicPage = within(nav)
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/e/launch-abc");
    expect(publicPage).toHaveAccessibleName(
      // jsdom's name computation drops the space a browser keeps.
      /^Public page ?\(opens in a new tab\)$/,
    );
    expect(publicPage).toHaveAttribute("target", "_blank");
  });

  it("links the report only once the event has ended, and says so before", () => {
    const { unmount } = render(
      <EventTabs event={EVENT} current="launch-control" />,
    );
    expect(screen.queryByRole("link", { name: "Report" })).toBeNull();
    expect(screen.getByText("Once the event has ended")).toBeInTheDocument();
    unmount();

    render(
      <EventTabs
        event={{ ...EVENT, status: "COMPLETED" }}
        current="launch-control"
      />,
    );
    expect(screen.getByRole("link", { name: "Report" })).toHaveAttribute(
      "href",
      "/events/e1/report",
    );
  });
});

describe("EventLifecycle", () => {
  it("marks the current stage and says what to do next", () => {
    render(<EventLifecycle status="CONFIGURING" blockers={3} />);

    expect(
      screen
        .getAllByRole("listitem")
        .find((item) => item.getAttribute("aria-current") === "step"),
    ).toHaveTextContent("Configuring");
    expect(screen.getByText(/Clear 3 hard blockers/)).toBeInTheDocument();
  });

  it("shows no stages for a cancelled event, only what it means", () => {
    render(<EventLifecycle status="CANCELLED" />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(
      screen.getByText(/Cancelled: nothing more to do/),
    ).toBeInTheDocument();
  });
});
