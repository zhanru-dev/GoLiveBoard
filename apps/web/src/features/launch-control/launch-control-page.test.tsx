import type {
  EventDetail,
  Readiness,
  RunbookTask,
} from "@goliveboard/contracts";
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
import { FakeRealtimeConnection, fakeRealtimeModule } from "@/testing/live";
import { server } from "@/testing/server";

import { LaunchControlPage } from "./launch-control-page";
import type * as ReadinessPanelModule from "./readiness-panel";

vi.mock("@/features/live/realtime-connection", () => fakeRealtimeModule());

// One part made to fail on demand, to show it fails alone.
const failing = vi.hoisted(() => new Set<string>());
vi.mock("./readiness-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof ReadinessPanelModule>();
  return {
    ...actual,
    ReadinessPanel: (props: Parameters<typeof actual.ReadinessPanel>[0]) => {
      if (failing.has("readiness")) {
        throw new Error("The readiness panel could not render");
      }
      return actual.ReadinessPanel(props);
    },
  };
});

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
    http.get(`*/api/v1/events/${EVENT_ID}/attendees`, () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/invitations`, () =>
      HttpResponse.json([]),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/chat/messages`, () =>
      HttpResponse.json({ items: [], latestSequence: 0, nextBefore: null }),
    ),
    http.get(`*/api/v1/events/${EVENT_ID}/questions`, () =>
      HttpResponse.json({ items: [], latestSequence: 0 }),
    ),
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

  it("links to the operations room, and to the report once completed", async () => {
    serveEvent();
    const { unmount } = renderScreen(
      <LaunchControlPage eventId={EVENT_ID} />,
      OWNER,
    );
    const pages = await screen.findByRole("navigation", {
      name: "Event pages",
    });
    expect(
      within(pages).getByRole("link", { name: "Operations room" }),
    ).toHaveAttribute("href", `/events/${EVENT_ID}/live`);
    expect(within(pages).queryByRole("link", { name: "Report" })).toBeNull();
    unmount();

    serveEvent(anEvent({ status: "COMPLETED", allowedTransitions: [] }));
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    expect(await screen.findByRole("link", { name: "Report" })).toHaveAttribute(
      "href",
      `/events/${EVENT_ID}/report`,
    );
  });

  it("offers the demo its test stream instead of an address field", async () => {
    serveEvent();
    const demo = {
      ...OWNER,
      activeWorkspace: { ...OWNER.activeWorkspace, isDemo: true },
    };
    const { unmount } = renderScreen(
      <LaunchControlPage
        eventId={EVENT_ID}
        demoStreamUrl="https://test-streams.example.com/demo.m3u8"
      />,
      demo,
    );

    expect(
      await screen.findByRole("button", { name: "Use the demo test stream" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("HLS playback URL")).toBeNull();
    unmount();

    // Without a test stream, the demo cannot set one at all.
    serveEvent();
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, demo);
    expect(
      await screen.findByText(/Stream checks are switched off in the demo/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stream/i })).toBeNull();
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

  describe("task owners and due times (FR-LC-1)", () => {
    const GRACE = {
      membershipId: "0195f0a0-0000-7000-8000-0000000000b2",
      userId: "0195f0a0-0000-7000-8000-000000000002",
      name: "Grace Hopper",
      email: "grace@example.com",
      role: "MANAGER" as const,
      joinedAt: "2026-11-13T10:00:00.000Z",
    };

    it("adds a task with an owner and a due time in the event's zone", async () => {
      serveEvent();
      let body: unknown;
      server.use(
        http.get("*/api/v1/workspace/members", () =>
          HttpResponse.json([GRACE]),
        ),
        http.post(
          `*/api/v1/events/${EVENT_ID}/runbook-tasks`,
          async ({ request }) => {
            body = await request.json();
            return HttpResponse.json(TASK, { status: 201 });
          },
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      await user.type(
        await screen.findByLabelText("New task"),
        "Brief the speakers",
      );
      const owner = await screen.findByRole("combobox", { name: "Task owner" });
      await within(owner).findByRole("option", { name: "Grace Hopper" });
      await user.selectOptions(owner, GRACE.userId);
      await user.type(screen.getByLabelText("Due"), "2026-07-01T17:00");
      await user.click(screen.getByRole("button", { name: "Add task" }));

      await vi.waitFor(() => {
        expect(body).toEqual({
          title: "Brief the speakers",
          isCritical: false,
          ownerUserId: GRACE.userId,
          // 17:00 in London in July is 16:00 UTC.
          dueAt: "2026-07-01T16:00:00.000Z",
        });
      });
    });

    it("shows a task's owner and due time, and changes only what was edited", async () => {
      serveEvent();
      server.use(
        http.get("*/api/v1/workspace/members", () =>
          HttpResponse.json([GRACE]),
        ),
        http.get(`*/api/v1/events/${EVENT_ID}/runbook-tasks`, () =>
          HttpResponse.json([
            {
              ...TASK,
              owner: { userId: GRACE.userId, name: GRACE.name },
              dueAt: "2026-12-01T17:00:00.000Z",
            },
          ]),
        ),
      );
      let patch: { body?: unknown; ifMatch?: string | null } = {};
      server.use(
        http.patch(`*/api/v1/runbook-tasks/${TASK.id}`, async ({ request }) => {
          patch = {
            body: await request.json(),
            ifMatch: request.headers.get("if-match"),
          };
          return HttpResponse.json(TASK);
        }),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      const details = await screen.findByText(/Owner: Grace Hopper/);
      expect(details).toHaveTextContent(
        "Owner: Grace Hopper · Due Tue, 1 Dec 2026, 17:00 GMT",
      );
      await user.click(
        screen.getByRole("button", { name: "Edit Rehearse the opening" }),
      );
      const due = await screen.findAllByLabelText("Due");
      // The editor's field comes first; the add-task form's is below it.
      const editorDue = due[0];
      if (editorDue === undefined) throw new Error("No due field");
      expect(editorDue).toHaveValue("2026-12-01T17:00");
      await user.clear(editorDue);
      await user.type(editorDue, "2026-12-01T16:30");
      await user.click(screen.getByRole("button", { name: "Save task" }));

      await vi.waitFor(() => {
        expect(patch).toEqual({
          body: { dueAt: "2026-12-01T16:30:00.000Z" },
          ifMatch: '"4"',
        });
      });
    });

    it("never pairs an open draft with a newer version of the task", async () => {
      const OTHER = {
        ...TASK,
        id: "0195f0a0-0000-7000-8000-0000000000f2",
        title: "Test the stream",
        position: 2,
        version: 1,
      };
      let stored: RunbookTask[] = [TASK, OTHER];
      serveEvent();
      const patches: { id: string; body: unknown; ifMatch: string | null }[] =
        [];
      server.use(
        http.get(`*/api/v1/events/${EVENT_ID}/runbook-tasks`, () =>
          HttpResponse.json(stored),
        ),
        http.patch(
          "*/api/v1/runbook-tasks/:id",
          async ({ request, params }) => {
            const ifMatch = request.headers.get("if-match");
            patches.push({
              id: String(params.id),
              body: await request.json(),
              ifMatch,
            });
            const current = stored.find((task) => task.id === params.id);
            if (ifMatch !== `"${String(current?.version)}"`) {
              return HttpResponse.json(problem(412, "PRECONDITION_FAILED"), {
                status: 412,
              });
            }
            return HttpResponse.json(current);
          },
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "Edit Rehearse the opening",
        }),
      );
      // A colleague renames the task; then something refreshes the runbook.
      stored = [
        { ...TASK, title: "Rehearse the welcome", version: 5 },
        { ...OTHER, status: "DONE", version: 2 },
      ];
      await user.click(
        screen.getByRole("checkbox", { name: "Test the stream done" }),
      );
      expect(
        await screen.findByText(
          "Someone else changed this task while you were editing it.",
        ),
      ).toBeInTheDocument();
      const editorDue = (await screen.findAllByLabelText("Due"))[0];
      if (editorDue === undefined) throw new Error("No due field");
      await user.type(editorDue, "2026-12-01T16:30");
      await user.click(screen.getByRole("button", { name: "Save task" }));

      // The old draft goes with the old version, so it is refused, and the
      // colleague's title is never sent back over theirs.
      await vi.waitFor(() => {
        expect(patches.filter((patch) => patch.id === TASK.id)).toEqual([
          {
            id: TASK.id,
            body: { dueAt: "2026-12-01T16:30:00.000Z" },
            ifMatch: '"4"',
          },
        ]);
      });
      await user.click(
        screen.getByRole("button", { name: "Start again from their version" }),
      );
      expect(screen.getByLabelText("Task title")).toHaveValue(
        "Rehearse the welcome",
      );
      expect(
        screen.queryByText(
          "Someone else changed this task while you were editing it.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("creates the access policy without a version, then saves with one", async () => {
    serveEvent();
    const ifMatches: (string | null)[] = [];
    let stored: { privacyNoticeVersion: string; version: number } | null = null;
    const policy = () => ({
      mode: "PUBLIC",
      allowedDomains: [],
      privacyNoticeVersion: stored?.privacyNoticeVersion ?? "",
      version: stored?.version ?? 0,
      updatedAt: "2026-11-13T09:00:00.000Z",
    });
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}/access-policy`, () =>
        stored === null
          ? HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 })
          : HttpResponse.json(policy()),
      ),
      http.put(
        `*/api/v1/events/${EVENT_ID}/access-policy`,
        async ({ request }) => {
          ifMatches.push(request.headers.get("if-match"));
          const body = (await request.json()) as {
            privacyNoticeVersion: string;
          };
          stored = {
            privacyNoticeVersion: body.privacyNoticeVersion,
            version: (stored?.version ?? 0) + 1,
          };
          return HttpResponse.json(policy());
        },
      ),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    await user.type(
      await screen.findByLabelText("Privacy notice version"),
      "2026-11",
    );
    await user.click(screen.getByRole("button", { name: "Set access policy" }));
    // After the refresh the form shows the stored policy, version 1.
    await screen.findByRole("button", { name: "Save access policy" });
    const notice = screen.getByLabelText("Privacy notice version");
    expect(notice).toHaveValue("2026-11");
    await user.clear(notice);
    await user.type(notice, "2026-12");
    await user.click(
      screen.getByRole("button", { name: "Save access policy" }),
    );

    await vi.waitFor(() => {
      expect(ifMatches).toEqual([null, '"1"']);
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

  it("saves only what changed, so a time in a repeated hour does not move", async () => {
    // 06:30Z is the second 01:30 of the night New York's clocks go back.
    serveEvent(
      anEvent({
        timeZone: "America/New_York",
        startsAt: "2026-11-01T06:30:00.000Z",
        endsAt: "2026-11-01T08:00:00.000Z",
      }),
    );
    let body: unknown;
    server.use(
      http.patch(`*/api/v1/events/${EVENT_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(anEvent({ version: 4 }));
      }),
    );
    renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
    const user = userEvent.setup();

    const title = await screen.findByLabelText("Title", { exact: true });
    expect(screen.getByLabelText("The second 01:30 (UTC−05:00)")).toBeChecked();
    await user.clear(title);
    await user.type(title, "Renamed launch");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await vi.waitFor(() => {
      expect(body).toEqual({ title: "Renamed launch" });
    });
  });

  it("shows a stream failure found in the background, without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let failing = false;
      serveEvent(
        anEvent({ streamUrl: "https://stream.example.com/live.m3u8" }),
      );
      server.use(
        http.get(`*/api/v1/events/${EVENT_ID}/readiness`, () =>
          HttpResponse.json(
            failing
              ? aReadiness({
                  blockers: [
                    {
                      criterion: "STREAM_REACHABLE",
                      evidence: "The last stream check failed.",
                    },
                  ],
                })
              : aReadiness({ blockers: [] }),
          ),
        ),
        http.get(`*/api/v1/events/${EVENT_ID}/stream/checks`, () =>
          HttpResponse.json({
            items: failing
              ? [
                  {
                    id: "0195f0a0-0000-7000-8000-0000000000c9",
                    url: "https://stream.example.com/live.m3u8",
                    checkedAt: "2026-11-13T09:00:30.000Z",
                    ok: false,
                    httpStatus: 404,
                    latencyMs: 80,
                    failure: "HTTP 404",
                  },
                ]
              : [],
            nextCursor: null,
          }),
        ),
        http.get(`*/api/v1/events/${EVENT_ID}/incidents`, () =>
          HttpResponse.json(
            failing
              ? [
                  {
                    id: "0195f0a0-0000-7000-8000-0000000000d1",
                    kind: "STREAM_UNREACHABLE",
                    openedAt: "2026-11-13T09:00:30.000Z",
                    resolvedAt: null,
                  },
                ]
              : [],
          ),
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      expect(
        await screen.findByText(
          "No hard blockers: the event can be marked ready.",
        ),
      ).toBeInTheDocument();

      failing = true;
      await vi.advanceTimersByTimeAsync(10_000);

      expect(
        await screen.findByText(/1 hard blocker must be resolved/),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(/Stream unreachable since/),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  describe("the audience (docs/04, section 3.4)", () => {
    const ATTENDEE = {
      id: "0195f0a0-0000-7000-8000-0000000000b1",
      name: "Grace Hopper",
      email: "grace@example.com",
      status: "VERIFIED" as const,
      remindersOptIn: true,
      registeredAt: "2026-11-10T09:00:00.000Z",
      verifiedAt: "2026-11-10T09:05:00.000Z",
    };

    it("lists who registered and revokes after the Manager confirms", async () => {
      serveEvent();
      const revoked: string[] = [];
      server.use(
        http.get(`*/api/v1/events/${EVENT_ID}/attendees`, () =>
          HttpResponse.json({ items: [ATTENDEE], nextCursor: null }),
        ),
        http.post(
          `*/api/v1/events/${EVENT_ID}/attendees/:attendeeId/revoke`,
          ({ params }) => {
            revoked.push(String(params.attendeeId));
            return HttpResponse.json({ ...ATTENDEE, status: "REVOKED" });
          },
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      const audience = await screen.findByRole("region", { name: "Audience" });
      const row = (await within(audience).findByText("Grace Hopper")).closest(
        "tr",
      );
      expect(row).toHaveTextContent("grace@example.com");
      await user.click(
        within(row as HTMLElement).getByRole("button", { name: "Revoke" }),
      );
      expect(revoked).toEqual([]);
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Revoke",
        }),
      );

      await vi.waitFor(() => {
        expect(revoked).toEqual([ATTENDEE.id]);
      });
    });

    it("shows Analysts the list without any action or invitations", async () => {
      serveEvent();
      server.use(
        http.get(`*/api/v1/events/${EVENT_ID}/attendees`, () =>
          HttpResponse.json({
            items: [{ ...ATTENDEE, email: "g***@example.com" }],
            nextCursor: null,
          }),
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, ANALYST);

      const audience = await screen.findByRole("region", { name: "Audience" });
      expect(
        await within(audience).findByText("g***@example.com"),
      ).toBeInTheDocument();
      expect(
        within(audience).queryByRole("button", { name: /Revoke|Erase/ }),
      ).toBeNull();
      expect(within(audience).queryByText("Invitations")).toBeNull();
    });
  });

  describe("chat and Q&A (FR-RN-3 to FR-RN-5)", () => {
    const QUESTION = {
      id: "0195f0a0-0000-7000-8000-0000000000a1",
      body: "Will it ship on time?",
      status: "PENDING" as const,
      author: { kind: "ATTENDEE" as const, name: "Ada" },
      pinSlot: null,
      voteCount: 2,

      mergedIntoId: null,

      version: 1,
      createdAt: "2026-11-15T12:00:00.000Z",
      mine: false,
      votedByMe: false,
    };
    const MESSAGE = {
      id: "0195f0a0-0000-7000-8000-0000000000b1",
      sequence: 1,
      author: { kind: "ATTENDEE" as const, name: "Ada" },
      body: "Something rude",
      deleted: false,
      createdAt: "2026-11-15T12:00:00.000Z",
    };

    function serveLive() {
      server.use(
        http.get(`*/api/v1/events/${EVENT_ID}/questions`, () =>
          HttpResponse.json({ items: [QUESTION], latestSequence: 1 }),
        ),
        http.get(`*/api/v1/events/${EVENT_ID}/chat/messages`, () =>
          HttpResponse.json({
            items: [MESSAGE],
            latestSequence: 1,
            nextBefore: null,
          }),
        ),
      );
    }

    it("approves a question with its version, and follows changes made elsewhere", async () => {
      serveEvent();
      serveLive();
      const patches: { body: unknown; ifMatch: string | null }[] = [];
      server.use(
        http.patch(`*/api/v1/questions/${QUESTION.id}`, async ({ request }) => {
          patches.push({
            body: await request.json(),
            ifMatch: request.headers.get("If-Match"),
          });
          return HttpResponse.json({
            ...QUESTION,
            status: "PUBLISHED",
            version: 2,
          });
        }),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "Approve: Will it ship on time?",
        }),
      );

      expect(patches).toEqual([
        { body: { status: "PUBLISHED" }, ifMatch: '"1"' },
      ]);
      const list = screen.getByRole("list", { name: "Questions to moderate" });
      expect(await within(list).findByText("Published")).toBeVisible();
      FakeRealtimeConnection.last?.deliver("QUESTIONS", {
        sequence: 3,
        kind: "UPDATED",
        question: { ...QUESTION, status: "PUBLISHED", pinSlot: 1, version: 3 },
      });
      expect(await within(list).findByText("Pinned")).toBeVisible();
    });

    it("lets Analysts follow chat and Q&A, but not moderate or write", async () => {
      serveEvent();
      serveLive();
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, ANALYST);

      expect(
        await screen.findByText("Will it ship on time?"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^Delete message/ }),
      ).toBeNull();
      expect(screen.getByText(/Analysts follow the chat/)).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: /wait for approval/ }),
      ).toBeDisabled();
    });

    it("turns pre-moderation on with the event's version", async () => {
      serveEvent();
      const patches: { body: unknown; ifMatch: string | null }[] = [];
      server.use(
        http.patch(`*/api/v1/events/${EVENT_ID}`, async ({ request }) => {
          patches.push({
            body: await request.json(),
            ifMatch: request.headers.get("If-Match"),
          });
          return HttpResponse.json(anEvent({ questionsPreModerated: true }));
        }),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("checkbox", { name: /wait for approval/ }),
      );

      expect(patches).toEqual([
        { body: { questionsPreModerated: true }, ifMatch: '"3"' },
      ]);
    });

    it("deletes a chat message once the Manager confirms", async () => {
      serveEvent();
      serveLive();
      const deleted: string[] = [];
      server.use(
        http.delete(
          `*/api/v1/events/${EVENT_ID}/chat/messages/${MESSAGE.id}`,
          () => {
            deleted.push(MESSAGE.id);
            return HttpResponse.json({ ...MESSAGE, body: "", deleted: true });
          },
        ),
      );
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", { name: "Delete message from Ada" }),
      );
      expect(deleted).toEqual([]);
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(deleted).toEqual([MESSAGE.id]);
    });

    it("waits until the event is being configured", async () => {
      serveEvent(anEvent({ status: "DRAFT" }));
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);

      expect(
        await screen.findByText(/open once the event is being configured/),
      ).toBeVisible();
    });
  });

  it("keeps a part that fails to render to that part: the readiness panel breaks, the runbook works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("reportError", vi.fn());
    failing.add("readiness");
    try {
      serveEvent();
      renderScreen(<LaunchControlPage eventId={EVENT_ID} />, OWNER);

      expect(
        await screen.findByText("Rehearse the opening"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Something went wrong showing the readiness panel."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Something went wrong showing the runbook/),
      ).not.toBeInTheDocument();
    } finally {
      failing.clear();
      vi.unstubAllGlobals();
    }
  });
});
