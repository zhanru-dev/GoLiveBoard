import type {
  WebhookDelivery,
  WebhookEndpoint,
  Workspace,
} from "@opspilot/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ANALYST, problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { IntegrationsPage } from "./integrations-page";

const ENDPOINT: WebhookEndpoint = {
  id: "0195f0a0-0000-7000-8000-0000000000d1",
  url: "https://hooks.example.com/opspilot",
  eventTypes: ["event.completed", "event.live"],
  description: "CRM",
  active: true,
  version: 3,
  createdAt: "2026-11-16T09:00:00.000Z",
  updatedAt: "2026-11-16T09:00:00.000Z",
};

const DELIVERY: WebhookDelivery = {
  id: "0195f0a0-0000-7000-8000-0000000000d2",
  endpointId: ENDPOINT.id,
  eventId: "0195f0a0-0000-7000-8000-0000000000d3",
  eventType: "event.live",
  status: "FAILED",
  attempts: 5,
  nextAttemptAt: null,
  createdAt: "2026-11-16T09:00:00.000Z",
  history: [
    {
      attemptedAt: "2026-11-16T11:36:00.000Z",
      statusCode: 503,
      durationMs: 40,
      error: "The receiver answered 503",
    },
  ],
};

const WORKSPACE: Workspace = {
  id: OWNER.activeWorkspace.workspaceId,
  name: "Ada's workspace",
  retentionDays: 90,
  webhooksIncludePersonalData: false,
};

function serve(endpoints: WebhookEndpoint[] = [ENDPOINT]) {
  server.use(
    http.get("*/api/v1/webhook-endpoints", () => HttpResponse.json(endpoints)),
    http.get("*/api/v1/workspace", () => HttpResponse.json(WORKSPACE)),
  );
}

describe("IntegrationsPage", () => {
  it("tells other roles that only Owners manage webhooks", () => {
    renderScreen(<IntegrationsPage />, ANALYST);

    expect(
      screen.getByText("Only the workspace's Owners manage webhooks."),
    ).toBeInTheDocument();
  });

  it("adds an endpoint and shows its secret once", async () => {
    serve([]);
    let sent: unknown;
    server.use(
      http.post("*/api/v1/webhook-endpoints", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          { endpoint: ENDPOINT, secret: "whsec_shown-once" },
          { status: 201 },
        );
      }),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Receiver URL"),
      "https://hooks.example.com/opspilot",
    );
    await user.click(screen.getByLabelText(/An event goes live/));
    await user.click(screen.getByLabelText(/An event completes/));
    await user.click(screen.getByRole("button", { name: "Add endpoint" }));

    expect(sent).toEqual({
      url: "https://hooks.example.com/opspilot",
      eventTypes: ["event.completed", "event.live"],
      description: "",
    });
    const notice = await screen.findByRole("alert");
    expect(within(notice).getByText("whsec_shown-once")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText("whsec_shown-once")).toBeNull();
  });

  it("asks for at least one event, and shows the API's refusal of the URL", async () => {
    serve([]);
    server.use(
      http.post("*/api/v1/webhook-endpoints", () =>
        HttpResponse.json(
          problem(422, "VALIDATION_FAILED", {
            errors: [
              {
                path: "url",
                code: "address_not_allowed",
                message: "The host must resolve to the public internet",
              },
            ],
          }),
          { status: 422 },
        ),
      ),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Receiver URL"),
      "https://10.0.0.7/in",
    );

    await user.click(screen.getByRole("button", { name: "Add endpoint" }));
    expect(
      await screen.findByText("Choose at least one event."),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText(/An event goes live/));
    await user.click(screen.getByRole("button", { name: "Add endpoint" }));
    expect(
      await screen.findByText("The host must resolve to the public internet"),
    ).toBeInTheDocument();
  });

  it("pauses an endpoint with the version it was loaded at", async () => {
    serve();
    let ifMatch: string | null = null;
    let body: unknown;
    server.use(
      http.patch(
        `*/api/v1/webhook-endpoints/${ENDPOINT.id}`,
        async ({ request }) => {
          ifMatch = request.headers.get("if-match");
          body = await request.json();
          return HttpResponse.json({ ...ENDPOINT, active: false, version: 4 });
        },
      ),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const item = await screen.findByRole("listitem", { name: ENDPOINT.url });

    await userEvent
      .setup()
      .click(within(item).getByRole("button", { name: "Pause" }));

    await expect.poll(() => ifMatch).toBe('"3"');
    expect(body).toEqual({ active: false });
  });

  it("rotates the secret after asking, and shows the new one", async () => {
    serve();
    server.use(
      http.post(`*/api/v1/webhook-endpoints/${ENDPOINT.id}/rotate-secret`, () =>
        HttpResponse.json({ secret: "whsec_new" }),
      ),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const user = userEvent.setup();
    const item = await screen.findByRole("listitem", { name: ENDPOINT.url });

    await user.click(
      within(item).getByRole("button", { name: "Rotate secret" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Rotate secret",
      }),
    );

    expect(await screen.findByText("whsec_new")).toBeInTheDocument();
  });

  it("lists an endpoint's deliveries and sends a failed one again", async () => {
    serve();
    let redelivered = false;
    server.use(
      http.get("*/api/v1/webhook-deliveries", ({ request }) => {
        expect(new URL(request.url).searchParams.get("endpointId")).toBe(
          ENDPOINT.id,
        );
        return HttpResponse.json({ items: [DELIVERY], nextCursor: null });
      }),
      http.post(`*/api/v1/webhook-deliveries/${DELIVERY.id}/redeliver`, () => {
        redelivered = true;
        return HttpResponse.json({ ...DELIVERY, status: "PENDING" });
      }),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const user = userEvent.setup();
    const item = await screen.findByRole("listitem", { name: ENDPOINT.url });

    await user.click(within(item).getByRole("button", { name: "Deliveries" }));
    const row = (
      await screen.findByText("event.live", { selector: "td" })
    ).closest("tr");
    expect(row).toHaveTextContent("Failed");
    expect(row).toHaveTextContent("5 attempts");
    expect(row).toHaveTextContent("The receiver answered 503");
    await user.click(
      within(row ?? document.body).getByRole("button", { name: "Send again" }),
    );

    await expect.poll(() => redelivered).toBe(true);
  });

  it("switches personal data in webhooks on", async () => {
    serve();
    let body: unknown;
    server.use(
      http.patch("*/api/v1/workspace", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...WORKSPACE,
          webhooksIncludePersonalData: true,
        });
      }),
    );
    renderScreen(<IntegrationsPage />, OWNER);
    const box = await screen.findByRole("checkbox", {
      name: /Include the attendee's name and email address/,
    });
    await expect.poll(() => (box as HTMLInputElement).disabled).toBe(false);

    await userEvent.setup().click(box);

    await expect
      .poll(() => body)
      .toEqual({ webhooksIncludePersonalData: true });
    await expect.poll(() => (box as HTMLInputElement).checked).toBe(true);
  });
});
