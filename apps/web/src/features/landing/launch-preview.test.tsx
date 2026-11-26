import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LaunchPreview } from "./launch-preview";

function currentStage() {
  return screen
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-current") === "step")?.textContent;
}

describe("LaunchPreview", () => {
  it("starts at 72 with one hard blocker, so the event cannot be marked ready", () => {
    render(<LaunchPreview intro={null} />);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("1 hard blocker")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as ready" }),
    ).toBeDisabled();
    expect(currentStage()).toContain("Configuring");
  });

  it("clears the blocker when the critical task is ticked, then moves to Ready", async () => {
    const user = userEvent.setup();
    render(<LaunchPreview intro={null} />);

    await user.click(screen.getByRole("checkbox", { name: /Critical tasks/ }));

    expect(screen.getByText("98")).toBeInTheDocument();
    expect(screen.getByText("No blockers")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark as ready" }));
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(currentStage()).toContain("Ready");
  });

  it("goes back to Configuring when the task is unticked", async () => {
    const user = userEvent.setup();
    render(<LaunchPreview intro={null} />);
    const task = screen.getByRole("checkbox", { name: /Critical tasks/ });
    await user.click(task);
    await user.click(screen.getByRole("button", { name: "Mark as ready" }));

    await user.click(task);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("CONFIGURING")).toBeInTheDocument();
    expect(currentStage()).toContain("Configuring");
  });
});
