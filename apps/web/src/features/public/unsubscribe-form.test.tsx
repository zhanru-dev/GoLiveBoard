import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { UnsubscribeForm } from "./unsubscribe-form";

describe("UnsubscribeForm (FR-AD-5)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("stops reminders on a click, not on opening the link", async () => {
    window.history.replaceState(null, "", "/reminders/unsubscribe#token=t0k3n");
    const bodies: unknown[] = [];
    server.use(
      http.post(
        "*/api/v1/public/reminders/unsubscribe",
        async ({ request }) => {
          bodies.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderScreen(<UnsubscribeForm />);
    expect(bodies).toEqual([]);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Stop reminders" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "You will not get any more reminders.",
    );
    expect(bodies).toEqual([{ token: "t0k3n" }]);
  });
});
