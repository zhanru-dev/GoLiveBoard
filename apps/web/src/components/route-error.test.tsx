import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteError } from "./route-error";

describe("RouteError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the error, moves focus to the message, and retries on request", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const retry = vi.fn();
    const error = new Error("The page could not render");

    render(<RouteError error={error} retry={retry} />);

    const heading = screen.getByRole("heading", {
      name: "Something went wrong",
    });
    expect(heading).toHaveFocus();
    expect(reportError).toHaveBeenCalledWith(error);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
