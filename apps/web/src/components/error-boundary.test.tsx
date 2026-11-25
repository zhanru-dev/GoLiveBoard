import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

let broken = true;

function Chat() {
  if (broken) {
    throw new Error("The chat could not render");
  }
  return <p>Chat messages</p>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a part that fails to render to itself, reports it, and renders it again on request", async () => {
    // React logs caught errors; they are expected here.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    broken = true;

    render(
      <>
        <p>The video</p>
        <ErrorBoundary what="the chat">
          <Chat />
        </ErrorBoundary>
      </>,
    );

    // The rest of the page is untouched.
    expect(screen.getByText("The video")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong showing the chat.",
    );
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "The chat could not render" }),
    );

    broken = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Chat messages")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
