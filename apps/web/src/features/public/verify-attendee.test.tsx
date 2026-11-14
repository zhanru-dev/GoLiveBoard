import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";
import { router } from "@/testing/setup";

import { VerifyAttendee } from "./verify-attendee";

const SLUG = "product-launch-x1y2z3a4b5";

describe("VerifyAttendee (FR-AD-3)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("uses the link's token once and opens the event page", async () => {
    window.history.replaceState(null, "", `/e/${SLUG}/verify#token=abc123`);
    const tokens: unknown[] = [];
    server.use(
      http.post(
        "*/api/v1/public/attendee-verifications",
        async ({ request }) => {
          tokens.push(await request.json());
          return HttpResponse.json({ slug: SLUG });
        },
      ),
    );

    renderScreen(<VerifyAttendee slug={SLUG} />);

    await vi.waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/e/${SLUG}`);
    });
    // Long enough for a second request to arrive, had one been sent.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tokens).toEqual([{ token: "abc123" }]);
  });

  it("explains a used or expired link", async () => {
    window.history.replaceState(null, "", `/e/${SLUG}/verify#token=old`);
    server.use(
      http.post("*/api/v1/public/attendee-verifications", () =>
        HttpResponse.json(
          {
            type: "/problems/token-invalid",
            title: "The link is invalid",
            status: 400,
            code: "TOKEN_INVALID",
            requestId: "r",
          },
          { status: 400 },
        ),
      ),
    );

    renderScreen(<VerifyAttendee slug={SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link has expired or has already been used.",
    );
  });
});
