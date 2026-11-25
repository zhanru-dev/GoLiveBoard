import { describe, expect, it, vi } from "vitest";

import { reportCaughtError } from "./report-caught-error";

describe("reportCaughtError", () => {
  it("hands an error from the browser to the window, as an uncaught one", () => {
    const target = { reportError: vi.fn() };
    const error = new Error("The chat could not render");

    reportCaughtError(error, target);

    expect(target.reportError).toHaveBeenCalledWith(error);
  });

  it("leaves an error rendered on the server to the server, which reported it", () => {
    const target = { reportError: vi.fn() };

    reportCaughtError(
      Object.assign(
        new Error("An error occurred in the Server Components render"),
        {
          digest: "2338937482",
        },
      ),
      target,
    );

    expect(target.reportError).not.toHaveBeenCalled();
  });
});
