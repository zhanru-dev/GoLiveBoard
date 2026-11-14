import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";
import { router } from "@/testing/setup";

import { DemoSignIn } from "./demo-sign-in";

describe("DemoSignIn", () => {
  it("signs in to the demo with one click and opens the events", async () => {
    let calls = 0;
    server.use(
      http.post("*/api/v1/auth/demo", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderScreen(<DemoSignIn />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try the demo" }));

    expect(calls).toBe(1);
    expect(router.replace).toHaveBeenCalledWith("/events");
  });

  it("explains a refusal and lets the visitor try again", async () => {
    server.use(
      http.post("*/api/v1/auth/demo", () =>
        HttpResponse.json(
          {
            type: "/problems/rate-limited",
            title: "Too many attempts",
            status: 429,
            code: "RATE_LIMITED",
            detail: "Too many attempts. Try again later.",
            requestId: "r1",
          },
          {
            status: 429,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );
    renderScreen(<DemoSignIn />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try the demo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts",
    );
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
