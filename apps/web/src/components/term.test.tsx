import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Term } from "./term";

describe("Term", () => {
  it("shows and hides its definition from a button that says what it explains", async () => {
    const user = userEvent.setup();
    render(<Term term="holdingSlate" label="Holding slate" />);
    const button = screen.getByRole("button", {
      name: "What is holding slate?",
    });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/image attendees see/i)).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/image attendees see/i)).toBeVisible();

    await user.click(button);
    expect(screen.queryByText(/image attendees see/i)).not.toBeVisible();
  });
});
