import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { RegistrationForm } from "./registration-form";

const SLUG = "product-launch-x1y2z3a4b5";

function captureRegistrations() {
  const bodies: unknown[] = [];
  server.use(
    http.post(
      `*/api/v1/public/events/${SLUG}/registrations`,
      async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: "accepted" }, { status: 202 });
      },
    ),
  );
  return bodies;
}

async function fillIn(consent: boolean) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email address"), "ada@example.com");
  if (consent) {
    await user.click(screen.getByLabelText(/agree to it/));
  }
  await user.click(screen.getByRole("button", { name: "Register" }));
}

describe("RegistrationForm (FR-AD-3, FR-AD-6)", () => {
  it("registers with the notice version and consent, and says the same whatever the outcome", async () => {
    const bodies = captureRegistrations();
    renderScreen(
      <RegistrationForm
        slug={SLUG}
        privacyNoticeVersion="2026-11"
        demoMode={false}
      />,
    );

    await fillIn(true);

    expect(bodies).toEqual([
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        privacyNoticeVersion: "2026-11",
        consent: true,
        remindersOptIn: true,
      },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If this address can register, we have sent it a link",
    );
    expect(
      screen.queryByRole("link", { name: "Open the demo inbox" }),
    ).toBeNull();
  });

  it("asks for consent before sending anything", async () => {
    const bodies = captureRegistrations();
    renderScreen(
      <RegistrationForm
        slug={SLUG}
        privacyNoticeVersion="2026-11"
        demoMode={false}
      />,
    );

    await fillIn(false);

    expect(
      await screen.findByText("Agree to the privacy notice to register"),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("points a demo visitor to the demo inbox", async () => {
    captureRegistrations();
    renderScreen(
      <RegistrationForm slug={SLUG} privacyNoticeVersion="2026-11" demoMode />,
    );

    await fillIn(true);

    expect(
      await screen.findByRole("link", { name: "Open the demo inbox" }),
    ).toHaveAttribute("href", "/demo-inbox");
  });
});
