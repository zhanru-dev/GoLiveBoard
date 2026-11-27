import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderScreen } from "@/testing/render";

import { ChatPanel } from "./chat-panel";
import { QuestionsPanel } from "./questions-panel";

describe("ChatPanel", () => {
  it("sends what is typed, shows removed messages as such, and offers a retry", async () => {
    const onSend = vi.fn();
    const onRetry = vi.fn();
    renderScreen(
      <ChatPanel
        messages={[
          {
            id: "10000000-0000-4000-8000-000000000001",
            sequence: 1,
            author: { kind: "STAFF", name: "Grace" },
            body: "",
            deleted: true,
            createdAt: "2026-11-15T12:00:00.000Z",
          },
        ]}
        pending={[{ clientMessageId: "c1", body: "Mine", failed: true }]}
        onSend={onSend}
        onRetry={onRetry}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your message"), "  Hello  ");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onSend).toHaveBeenCalledWith("Hello");
    expect(onRetry).toHaveBeenCalledWith("c1");
    expect(screen.getByText("Message removed by a moderator.")).toBeVisible();
    expect(screen.getByText("(team)")).toBeVisible();
    // Attendees moderate nothing.
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("says why the viewer cannot write instead of showing the form", () => {
    renderScreen(
      <ChatPanel
        messages={[]}
        pending={[]}
        onSend={vi.fn()}
        onRetry={vi.fn()}
        disabledReason="The event has ended."
      />,
    );

    expect(screen.queryByLabelText("Your message")).toBeNull();
    expect(screen.getByText("The event has ended.")).toBeVisible();
  });
});

describe("QuestionsPanel", () => {
  const base = {
    author: { kind: "ATTENDEE" as const, name: "Ada" },
    pinSlot: null,
    answer: null,
    mergedIntoId: null,
    version: 1,
    createdAt: "2026-11-15T12:00:00.000Z",
  };

  it("votes for published questions only, showing the viewer's own vote", async () => {
    const onVote = vi.fn();
    renderScreen(
      <QuestionsPanel
        questions={[
          {
            ...base,
            id: "20000000-0000-4000-8000-000000000001",
            body: "Open",
            status: "PUBLISHED",
            voteCount: 3,
            votedByMe: true,
          },
          {
            ...base,
            id: "20000000-0000-4000-8000-000000000002",
            body: "Mine",
            status: "PENDING",
            voteCount: 0,
            mine: true,
          },
        ]}
        onVote={onVote}
        onAsk={vi.fn().mockResolvedValue(true)}
      />,
    );
    const user = userEvent.setup();

    const voteButton = screen.getByRole("button", { name: "Vote for: Open" });
    expect(voteButton).toHaveAttribute("aria-pressed", "true");
    await user.click(voteButton);

    expect(onVote).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Vote for: Mine" })).toBeNull();
    expect(screen.getByText(/Waiting for a moderator · Yours/)).toBeVisible();
  });

  it("shows the team's written answer under the question", () => {
    renderScreen(
      <QuestionsPanel
        questions={[
          {
            ...base,
            id: "20000000-0000-4000-8000-000000000004",
            body: "When does it ship?",
            status: "ANSWERED",
            voteCount: 2,
            answer: {
              body: "Next week, to everyone.",
              answeredAt: "2026-11-15T12:05:00.000Z",
            },
          },
        ]}
        onVote={vi.fn()}
        onAsk={vi.fn()}
      />,
    );

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Answer from the team");
    expect(item).toHaveTextContent("Next week, to everyone.");
  });

  it("shows its author a question merged into another, without a vote button", () => {
    renderScreen(
      <QuestionsPanel
        questions={[
          {
            ...base,
            id: "20000000-0000-4000-8000-000000000003",
            body: "Merged",
            status: "PUBLISHED",
            voteCount: 0,
            mine: true,
            mergedIntoId: "20000000-0000-4000-8000-000000000001",
          },
        ]}
        onVote={vi.fn()}
        onAsk={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Vote for: Merged" }),
    ).toBeNull();
    expect(screen.getByText(/Merged with a similar question/)).toBeVisible();
  });

  it("asks, and keeps the text when the question was not stored", async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderScreen(
      <QuestionsPanel questions={[]} onAsk={onAsk} error="Too many requests" />,
    );
    const user = userEvent.setup();
    const field = screen.getByLabelText("Your question");

    await user.type(field, "Why?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(field).toHaveValue("Why?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(field).toHaveValue("");
    expect(onAsk).toHaveBeenCalledWith("Why?");
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
  });
});
