import type { Poll } from "@goliveboard/contracts";
import { renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderScreen } from "@/testing/render";

import { currentPoll, PollCard } from "./poll-card";
import { percentOf } from "./poll-results";
import { mergePoll, orderPolls, usePolls } from "./use-polls";

const poll = (changes: Partial<Poll> = {}): Poll => ({
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  question: "Which demo next?",
  status: "OPEN",
  options: [
    {
      id: "0195f0a0-0000-7000-8000-0000000000b1",
      label: "Dashboards",
      votes: 3,
    },
    { id: "0195f0a0-0000-7000-8000-0000000000b2", label: "Webhooks", votes: 1 },
  ],
  totalVotes: 4,
  version: 5,
  openedAt: "2026-11-27T18:00:00.000Z",
  closedAt: null,
  createdAt: "2026-11-27T17:50:00.000Z",
  ...changes,
});

describe("mergePoll (FR-RN-8)", () => {
  it("keeps the newest version, whatever order snapshots arrive in", () => {
    const newer = poll({ version: 7, totalVotes: 6 });
    const older = poll({ version: 6, totalVotes: 5 });
    const merged = mergePoll(mergePoll(new Map(), newer), older);
    expect(merged.get(newer.id)?.totalVotes).toBe(6);
  });

  it("keeps the viewer's own answer when a snapshot without it arrives", () => {
    const mine = poll({ version: 6, myOptionId: poll().options[0]?.id });
    const merged = mergePoll(mergePoll(new Map(), mine), poll({ version: 6 }));
    expect(merged.get(mine.id)?.myOptionId).toBe(mine.myOptionId);
    const later = mergePoll(merged, poll({ version: 8 }));
    expect(later.get(mine.id)).toMatchObject({
      version: 8,
      myOptionId: mine.myOptionId,
    });
  });

  it("orders polls newest first", () => {
    const first = poll({
      id: "0195f0a0-0000-7000-8000-0000000000c1",
      createdAt: "2026-11-27T10:00:00.000Z",
    });
    const second = poll({
      id: "0195f0a0-0000-7000-8000-0000000000c2",
      createdAt: "2026-11-27T11:00:00.000Z",
    });
    expect(orderPolls([first, second]).map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});

describe("currentPoll and percentOf", () => {
  it("shows the open poll, otherwise the latest closed one, never a draft", () => {
    const open = poll({ id: "0195f0a0-0000-7000-8000-0000000000d1" });
    const closed = poll({
      id: "0195f0a0-0000-7000-8000-0000000000d2",
      status: "CLOSED",
    });
    const draft = poll({
      id: "0195f0a0-0000-7000-8000-0000000000d3",
      status: "DRAFT",
    });
    expect(currentPoll([closed, open])?.id).toBe(open.id);
    expect(currentPoll([draft, closed])?.id).toBe(closed.id);
    expect(currentPoll([draft])).toBeUndefined();
  });

  it("rounds to a whole percentage, and is 0 without answers", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("PollCard (FR-RN-8)", () => {
  it("asks for one answer, and hides the counts until then", async () => {
    const onAnswer = vi.fn().mockResolvedValue(true);
    const open = poll({ myOptionId: null });
    renderScreen(<PollCard polls={[open]} onAnswer={onAnswer} />);
    const user = userEvent.setup();

    expect(screen.queryByText(/75%/)).toBeNull();
    const send = screen.getByRole("button", { name: "Send answer" });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Webhooks" }));
    await user.click(send);

    expect(onAnswer).toHaveBeenCalledWith(open, open.options[1]?.id);
  });

  it("says the answer was sent and keeps the keyboard's place, once taken", async () => {
    const open = poll({ myOptionId: null });
    renderScreen(
      <PollCard polls={[open]} onAnswer={vi.fn().mockResolvedValue(true)} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Webhooks" }));
    await user.click(screen.getByRole("button", { name: "Send answer" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Answer sent");
    });
    expect(screen.getByRole("heading", { name: "Live poll" })).toHaveFocus();
  });

  it("says nothing was sent when the answer is refused", async () => {
    const onAnswer = vi.fn().mockResolvedValue(false);
    renderScreen(
      <PollCard polls={[poll({ myOptionId: null })]} onAnswer={onAnswer} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Webhooks" }));
    await user.click(screen.getByRole("button", { name: "Send answer" }));

    await vi.waitFor(() => {
      expect(onAnswer).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows the counts after answering, marking the attendee's answer", () => {
    renderScreen(
      <PollCard
        polls={[poll({ myOptionId: poll().options[0]?.id })]}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Dashboards · Your answer")).toBeVisible();
    expect(screen.getByText("75% (3)")).toBeVisible();
  });

  it("shows a closed poll's results to someone who did not answer", () => {
    renderScreen(
      <PollCard
        polls={[poll({ status: "CLOSED", myOptionId: null })]}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Poll results" })).toBeVisible();
    expect(screen.getByText("4 answers · Closed")).toBeVisible();
  });

  it("shows nothing without an open or closed poll", () => {
    renderScreen(
      <PollCard polls={[poll({ status: "DRAFT" })]} onAnswer={vi.fn()} />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("usePolls (FR-RN-8)", () => {
  it("loads the polls again when the event's status changes, and on request", async () => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const joined = new Set<never>();
    const { rerender, result } = renderHook(
      ({ status }: { status: "LIVE" | "COMPLETED" }) =>
        usePolls(undefined, joined, status, list),
      { initialProps: { status: "LIVE" } },
    );
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });

    // Completing the event closes its open poll without announcing it.
    rerender({ status: "COMPLETED" });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });

    result.current.reload();
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(3);
    });
  });
});
