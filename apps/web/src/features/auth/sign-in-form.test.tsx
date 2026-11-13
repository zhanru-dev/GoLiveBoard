import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/testing/server";
import { renderScreen } from "@/testing/render";
import { router } from "@/testing/setup";

import { SignInForm } from "./sign-in-form";

async function fillIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SignInForm", () => {
  it("signs in and opens the app", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/v1/auth/sign-in", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderScreen(<SignInForm />);

    await fillIn("ada@example.com", "correct horse battery");

    expect(body).toEqual({
      email: "ada@example.com",
      password: "correct horse battery",
    });
    expect(router.replace).toHaveBeenCalledWith("/settings/team");
  });

  it("shows the API's message when the credentials are wrong", async () => {
    server.use(
      http.post("*/api/v1/auth/sign-in", () =>
        HttpResponse.json(
          {
            type: "/problems/credentials-invalid",
            title: "The email address or password is incorrect",
            status: 401,
            code: "CREDENTIALS_INVALID",
            requestId: "req-1",
          },
          {
            status: 401,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );
    renderScreen(<SignInForm />);

    await fillIn("ada@example.com", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The email address or password is incorrect",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("checks the email address before sending anything", async () => {
    renderScreen(<SignInForm />);

    await fillIn("not-an-email", "whatever");

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
