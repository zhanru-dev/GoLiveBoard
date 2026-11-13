import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { anEvent, problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";
import { router } from "@/testing/setup";

import { NewEventPage } from "./new-event-page";

async function fillForm(
  starts = "2026-07-01T18:00",
  ends = "2026-07-01T19:30",
  zone = "Europe/London",
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Title"), "Product launch");
  await user.selectOptions(screen.getByLabelText("Time zone"), zone);
  await user.clear(screen.getByLabelText("Starts"));
  await user.type(screen.getByLabelText("Starts"), starts);
  await user.clear(screen.getByLabelText("Ends"));
  await user.type(screen.getByLabelText("Ends"), ends);
  return user;
}

describe("NewEventPage", () => {
  it("sends the times as UTC instants of the chosen zone, with an idempotency key", async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      http.post("*/api/v1/events", async ({ request }) => {
        body = await request.json();
        key = request.headers.get("idempotency-key");
        return HttpResponse.json(anEvent(), { status: 201 });
      }),
    );
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create event" }));

    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/events/${anEvent().id}`);
    });
    expect(body).toEqual({
      title: "Product launch",
      description: "",
      startsAt: "2026-07-01T17:00:00.000Z",
      endsAt: "2026-07-01T18:30:00.000Z",
      timeZone: "Europe/London",
      expectedAttendance: null,
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("retries with the same key after a failure, so nothing is created twice", async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post("*/api/v1/events", ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return keys.length === 1
          ? HttpResponse.json(problem(500, "INTERNAL_ERROR"), { status: 500 })
          : HttpResponse.json(anEvent(), { status: 201 });
      }),
    );
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await vi.waitFor(() => {
      expect(keys).toHaveLength(2);
    });
    expect(keys[1]).toBe(keys[0]);
  });

  it("checks that the end is after the start before sending", async () => {
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm();
    await user.clear(screen.getByLabelText("Ends"));
    await user.type(screen.getByLabelText("Ends"), "2026-07-01T17:00");

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(
      await screen.findByText("End must be after start."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ends")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("refuses a time the clocks skip", async () => {
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm(
      "2026-03-08T02:30",
      "2026-03-08T04:00",
      "America/New_York",
    );

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(
      await screen.findByText(
        "This time does not exist in America/New_York: the clocks go forward over it.",
      ),
    ).toBeInTheDocument();
  });

  it("asks which one is meant when a time happens twice, and sends that one", async () => {
    let body: { startsAt?: string } = {};
    server.use(
      http.post("*/api/v1/events", async ({ request }) => {
        body = (await request.json()) as { startsAt?: string };
        return HttpResponse.json(anEvent(), { status: 201 });
      }),
    );
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm(
      "2026-11-01T01:30",
      "2026-11-01T03:00",
      "America/New_York",
    );

    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(
      await screen.findByText(/This time happens twice in America\/New_York/),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText("The second 01:30 (UTC−05:00)"));
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await vi.waitFor(() => {
      expect(body.startsAt).toBe("2026-11-01T06:30:00.000Z");
    });
  });

  it("shows the API's field errors next to the form's fields", async () => {
    server.use(
      http.post("*/api/v1/events", () =>
        HttpResponse.json(
          problem(400, "VALIDATION_FAILED", {
            errors: [
              { path: "endsAt", code: "custom", message: "Too long an event." },
            ],
          }),
          { status: 400 },
        ),
      ),
    );
    renderScreen(<NewEventPage />, OWNER);
    const user = await fillForm();

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText("Too long an event.")).toBeInTheDocument();
  });
});
