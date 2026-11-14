import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { DemoInbox } from "./demo-inbox";

describe("DemoInbox (FR-AUTH-5)", () => {
  it("shows this browser's messages, with links to this site only", async () => {
    const origin = window.location.origin;
    server.use(
      http.get("*/api/v1/public/demo-inbox", () =>
        HttpResponse.json({
          messages: [
            {
              id: "0195f0a0-0000-7000-8000-0000000000a1",
              subject: "Confirm your registration for Product launch",
              text: `Confirm here:\n${origin}/e/launch/verify#token=abc\nNot here: https://evil.example/x`,
              receivedAt: "2026-11-14T12:00:00.000Z",
            },
          ],
        }),
      ),
    );

    renderScreen(<DemoInbox />);

    const message = await screen.findByRole("article", {
      name: "Confirm your registration for Product launch",
    });
    const links = within(message).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `${origin}/e/launch/verify#token=abc`,
    ]);
    expect(message).toHaveTextContent("https://evil.example/x");
  });
});
