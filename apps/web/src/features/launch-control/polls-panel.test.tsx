import type { Poll } from "@goliveboard/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { PollsPanel } from "./polls-panel";

const EVENT_ID = "0195f0a0-0000-7000-8000-0000000000e0";
const WORKSPACE_ID = "0195f0a0-0000-7000-8000-0000000000f0";

const poll = (changes: Partial<Poll> = {}): Poll => ({
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  question: "Which demo next?",
  status: "DRAFT",
  options: [
    {
      id: "0195f0a0-0000-7000-8000-0000000000b1",
      label: "Dashboards",
      votes: 0,
    },
    { id: "0195f0a0-0000-7000-8000-0000000000b2", label: "Webhooks", votes: 0 },
  ],
  totalVotes: 0,
  version: 1,
  openedAt: null,
  closedAt: null,
  createdAt: "2026-11-27T17:50:00.000Z",
  ...changes,
});

function panel(
  polls: Poll[],
  props: Partial<{ canEdit: boolean; open: boolean }> = {},
) {
  const onChange = vi.fn();
  const onDeleted = vi.fn();
  renderScreen(
    <PollsPanel
      eventId={EVENT_ID}
      workspaceId={WORKSPACE_ID}
      polls={polls}
      canEdit={props.canEdit ?? true}
      open={props.open ?? true}
      onChange={onChange}
      onDeleted={onDeleted}
    />,
  );
  return { onChange, onDeleted };
}

describe("PollsPanel (FR-RN-8)", () => {
  it("saves a draft with its question and options, adding one", async () => {
    let sent: unknown;
    server.use(
      http.post(`*/api/v1/events/${EVENT_ID}/polls`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(poll(), { status: 201 });
      }),
    );
    const { onChange } = panel([]);
    const user = userEvent.setup();
    const save = screen.getByRole("button", { name: "Save as draft" });

    await user.type(
      screen.getByLabelText("New poll question"),
      "Which demo next?",
    );
    await user.type(screen.getByLabelText("Option 1"), "Dashboards");
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Option 2"), "Webhooks");
    await user.click(screen.getByRole("button", { name: "Add an option" }));
    await user.type(screen.getByLabelText("Option 3"), "Reports");
    await user.click(save);

    await expect.poll(() => onChange.mock.calls.length).toBe(1);
    expect(sent).toEqual({
      question: "Which demo next?",
      options: ["Dashboards", "Webhooks", "Reports"],
    });
  });

  it("does not save two options that are the same", async () => {
    panel([]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New poll question"), "Same?");
    await user.type(screen.getByLabelText("Option 1"), "Yes");
    await user.type(screen.getByLabelText("Option 2"), "yes");
    expect(
      screen.getByRole("button", { name: "Save as draft" }),
    ).toBeDisabled();
  });

  it("opens a draft, and closes the open poll", async () => {
    const calls: string[] = [];
    server.use(
      http.post("*/api/v1/polls/:id/:action", ({ params }) => {
        calls.push(String(params.action));
        return HttpResponse.json(
          poll({
            status: params.action === "open" ? "OPEN" : "CLOSED",
            openedAt: "2026-11-27T18:00:00.000Z",
            closedAt:
              params.action === "open" ? null : "2026-11-27T18:05:00.000Z",
            version: 2,
          }),
        );
      }),
    );
    const { onChange } = panel([poll()]);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Open: Which demo next?" }),
    );
    await expect.poll(() => calls).toEqual(["open"]);
    expect(onChange).toHaveBeenCalled();
  });

  it("offers no second open while a poll is open, and lets Analysts only look", () => {
    panel([
      poll({
        id: "0195f0a0-0000-7000-8000-0000000000a2",
        status: "OPEN",
        openedAt: "2026-11-27T18:00:00.000Z",
        version: 2,
      }),
      poll(),
    ]);
    expect(
      screen.getByRole("button", { name: "Open: Which demo next?" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close: Which demo next?" }),
    ).toBeEnabled();
  });

  it("shows Analysts the polls without any way to run them", () => {
    panel([poll({ status: "OPEN", openedAt: "2026-11-27T18:00:00.000Z" })], {
      canEdit: false,
    });
    expect(screen.getByText("Which demo next?")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("New poll question")).toBeNull();
  });
});
