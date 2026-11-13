import type { EventDetail, Readiness } from "@opspilot/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import {
  ANALYST,
  aReadiness,
  anEvent,
  EVENT_ID,
  problem,
} from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { LaunchControlPage } from "./launch-control-page";

const TASK = {
  id: "0195f0a0-0000-7000-8000-0000000000f1",
  eventId: EVENT_ID,
  title: "Rehearse the opening",
  isCritical: true,
  status: "TODO" as const,
  position: 1,
  owner: null,
  dueAt: null,
  completedAt: null,
  completedBy: null,
  version: 4,
};

/** Every request Launch Control makes, answered with a fresh event. */
function serveEvent(
  event: EventDetail = anEvent(),
  readiness: Readiness = aReadiness(),
) {
  server.use(
    http.get(`*/api/v1/events/${EVENT_ID}`, () => HttpResponse.json(event)),
    http.get(`*/api/v1/events/${EVENT_ID}/readiness`, () =>
      HttpResponse.json(readiness),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/runbook-tasks`, () =>
      HttpResponse.json([TASK]),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/access-policy`, () =>
      HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 }),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/stream/checks`, () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/incidents`, () =>
      HttpResponse.json([]),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/assets/holding-slate`, () =>
      HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 }),
    ),
    http.get("*/api/v1/workspace/members", () => HttpResponse.json([])),
  );
}

describe("LaunchControlPage", () => {
  it("shows the readiness score, its evidence and what to do next", async () => {
    serveEvent();
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);

    const panel = await screen.findByRole("complementary", {
      name: "Readiness",
    });
    expect(await within(panel).findByText("35")).toBeInTheDocument();
    expect(
      within(panel).getByText("No access policy has been set."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Blocker")).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: "Choose who can register." }),
    ).toHaveAttribute("href", "#access-policy");
  });

  it("lists the blockers when going ready is refused", async () => {
    serveEvent();
    server.use(
      http.post(`*/api/v1/events/${EVENT_ID}/transitions`, () =>
        HttpResponse.json(
          problem(409, "EVENT_HAS_BLOCKERS", {
            title: "The event has unresolved hard blockers",
            detail: "Resolve the blockers before moving the event to READY.",
            blockers: [
              {
                criterion: "STREAM_REACHABLE",
                evidence: "No stream URL has been set.",
              },
            ],
          }),
          { status: 409 },
        ),
      ),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mark ready" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Resolve the blockers before moving the event to READY.",
    );
    expect(
      within(alert).getByText("No stream URL has been set."),
    ).toBeInTheDocument();
  });

  it("asks before cancelling", async () => {
    serveEvent();
    const moves: unknown[] = [];
    server.use(
      http.post(
        `*/api/v1/events/${EVENT_ID}/transitions`,
        async ({ request }) => {
          moves.push(await request.json());
          return HttpResponse.json(anEvent({ status: "CANCELLED" }));
        },
      ),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Cancel event" }),
    );
    expect(moves).toEqual([]);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel event",
      }),
    );

    await vi.waitFor(() => {
      expect(moves).toEqual([{ to: "CANCELLED" }]);
    });
  });

  it("completes a task with the version it was loaded at", async () => {
    serveEvent();
    let ifMatch: string | null = null;
    let body: unknown;
    server.use(
      http.patch(`*/api/v1/runbook-tasks/${TASK.id}`, async ({ request }) => {
        ifMatch = request.headers.get("if-match");
        body = await request.json();
        return HttpResponse.json({ ...TASK, status: "DONE", version: 5 });
      }),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Rehearse the opening done",
      }),
    );

    await vi.waitFor(() => {
      expect(body).toEqual({ status: "DONE" });
    });
    expect(ifMatch).toBe('"4"');
  });

  it("creates the access policy without a version, then saves with one", async () => {
    serveEvent();
    const ifMatches: (string | null)[] = [];
    server.use(
      http.put(`*/api/v1/events/${EVENT_ID}/access-policy`, ({ request }) => {
        ifMatches.push(request.headers.get("if-match"));
        return HttpResponse.json({
          mode: "PUBLIC",
          allowedDomains: [],
          privacyNoticeVersion: "2026-11",
          version: 1,
          updatedAt: "2026-11-13T09:00:00.000Z",
        });
      }),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.type(
      await screen.findByLabelText("Privacy notice version"),
      "2026-11",
    );
    await user.click(screen.getByRole("button", { name: "Set access policy" }));

    await vi.waitFor(() => {
      expect(ifMatches).toEqual([null]);
    });
  });

  it("uploads the holding slate to storage, then asks the API to verify it", async () => {
    serveEvent();
    const steps: string[] = [];
    server.use(
      http.post(
        `*/api/v1/events/${EVENT_ID}/assets/holding-slate`,
        async ({ request }) => {
          steps.push(`start ${JSON.stringify(await request.json())}`);
          return HttpResponse.json(
            {
              assetId: "0195f0a0-0000-7000-8000-0000000000a5",
              url: "http://storage.test/slates/a5?signature=x",
              method: "PUT",
              headers: { "Content-Type": "image/png" },
              expiresAt: "2026-11-13T09:05:00.000Z",
            },
            { status: 201 },
          );
        },
      ),
      http.put("http://storage.test/slates/a5", ({ request }) => {
        steps.push(`upload ${String(request.headers.get("content-type"))}`);
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(
        "*/api/v1/assets/0195f0a0-0000-7000-8000-0000000000a5/complete",
        () => {
          steps.push("complete");
          return HttpResponse.json({
            id: "0195f0a0-0000-7000-8000-0000000000a5",
            kind: "HOLDING_SLATE",
            status: "READY",
            contentType: "image/png",
            sizeBytes: 4,
            createdAt: "2026-11-13T09:00:00.000Z",
            updatedAt: "2026-11-13T09:00:00.000Z",
          });
        },
      ),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.upload(
      await screen.findByLabelText("Upload an image"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "slate.png", {
        type: "image/png",
      }),
    );

    await vi.waitFor(() => {
      expect(steps).toEqual([
        'start {"contentType":"image/png","sizeBytes":4}',
        "upload image/png",
        "complete",
      ]);
    });
  });

  it("refuses a file that is not an accepted image before uploading", async () => {
    serveEvent();
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      await screen.findByLabelText("Upload an image"),
      new File(["<svg/>"], "slate.svg", { type: "image/svg+xml" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a JPEG, PNG or WebP image.",
    );
  });

  it("shows Analysts the event without anything they could change", async () => {
    serveEvent();
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, ANALYST);

    expect(
      await screen.findByRole("heading", { name: "Product launch" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", {
        name: "Rehearse the opening done",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Mark ready" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New task")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Upload an image")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();
  });

  it("says when the event does not exist", async () => {
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}`, () =>
        HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 }),
      ),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This event was not found.",
    );
  });
});
