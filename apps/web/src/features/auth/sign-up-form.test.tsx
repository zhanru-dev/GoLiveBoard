import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/testing/server";
import { renderScreen } from "@/testing/render";
import { router } from "@/testing/setup";

import { SignUpForm } from "./sign-up-form";

const user = () => userEvent.setup();

async function fillIn(inviteCode?: string) {
  const person = user();
  if (inviteCode !== undefined) {
    await person.type(screen.getByLabelText("Invite code"), inviteCode);
  }
  await person.type(screen.getByLabelText("Your name"), "Ada Lovelace");
  await person.type(screen.getByLabelText("Email address"), "ada@example.com");
  await person.type(screen.getByLabelText("Password"), "correct horse battery");
  await person.click(screen.getByRole("button", { name: "Create account" }));
}

function acceptSignUp() {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/v1/auth/sign-up", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ status: "accepted" }, { status: 202 });
    }),
    http.post(
      "*/api/v1/auth/sign-in",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  return bodies;
}

describe("SignUpForm", () => {
  it("asks for no invite code when none is required", async () => {
    const bodies = acceptSignUp();
    renderScreen(<SignUpForm />);

    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
    await fillIn();

    expect(bodies).toEqual([
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "correct horse battery",
      },
    ]);
    expect(router.replace).toHaveBeenCalledWith("/events");
  });

  it("sends the invite code when one is required", async () => {
    const bodies = acceptSignUp();
    renderScreen(<SignUpForm codeRequired />);

    await fillIn("kestrel-lantern");

    expect(bodies).toEqual([
      expect.objectContaining({ inviteCode: "kestrel-lantern" }),
    ]);
    expect(router.replace).toHaveBeenCalledWith("/events");
  });

  it("asks for the code before sending anything", async () => {
    const bodies = acceptSignUp();
    renderScreen(<SignUpForm codeRequired />);

    await fillIn();

    expect(
      await screen.findByText("Enter your invite code"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Invite code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(bodies).toEqual([]);
  });

  it("shows a refused code on the code field", async () => {
    server.use(
      http.post("*/api/v1/auth/sign-up", () =>
        HttpResponse.json(
          {
            type: "/problems/sign-up-code-invalid",
            title: "That invite code is not valid",
            status: 403,
            code: "SIGN_UP_CODE_INVALID",
            requestId: "req-1",
          },
          {
            status: 403,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );
    renderScreen(<SignUpForm codeRequired />);

    await fillIn("wrong-code");

    expect(
      await screen.findByText("That invite code is not valid"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Invite code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
