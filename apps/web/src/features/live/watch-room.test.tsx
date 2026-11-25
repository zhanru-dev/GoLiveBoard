import type { WatchInfo } from "@opspilot/contracts";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeRealtimeConnection, fakeRealtimeModule } from "@/testing/live";
import { renderScreen } from "@/testing/render";
import { server } from "@/testing/server";
import { router } from "@/testing/setup";

import { HEARTBEAT_MS, WatchRoom } from "./watch-room";
import type * as ChatPanelModule from "./chat-panel";

vi.mock("@/features/live/realtime-connection", () => fakeRealtimeModule());

// One part made to fail on demand, to show it fails alone.
const failing = vi.hoisted(() => new Set<string>());
vi.mock("./chat-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof ChatPanelModule>();
  return {
    ...actual,
    ChatPanel: (props: Parameters<typeof actual.ChatPanel>[0]) => {
      if (failing.has("chat")) {
        throw new Error("The chat could not render");
      }
      return actual.ChatPanel(props);
    },
  };
});

const SLUG = "product-launch-k3x9q2mz7a";
const QUESTION = {
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  body: "Will it ship?",
  status: "PUBLISHED" as const,
  author: { kind: "ATTENDEE" as const, name: "Grace" },
  pinSlot: null,
  voteCount: 1,

  mergedIntoId: null,

  version: 1,
  createdAt: "2026-11-15T12:00:00.000Z",
  mine: false,
  votedByMe: false,
};

const info = (changes: Partial<WatchInfo> = {}): WatchInfo => ({
  slug: SLUG,
  title: "Product launch",
  status: "UPCOMING",
  streamUrl: null,
  slate: {
    url: "https://assets.example.com/slate.png",
    expiresAt: "2026-11-15T12:05:00.000Z",
  },
  ...changes,
});

function serveRoom() {
  server.use(
    http.get(`*/api/v1/public/events/${SLUG}/chat/messages`, () =>
      HttpResponse.json({ items: [], latestSequence: 0, nextBefore: null }),
    ),
    http.get(`*/api/v1/public/events/${SLUG}/questions`, () =>
      HttpResponse.json({ items: [QUESTION], latestSequence: 1 }),
    ),
  );
}

describe("WatchRoom (FR-RN-1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the slate before the event, and reloads for the stream when it goes live", async () => {
    serveRoom();
    renderScreen(<WatchRoom info={info()} />);

    expect(
      await screen.findByRole("img", { name: /has not started yet/ }),
    ).toHaveAttribute("src", "https://assets.example.com/slate.png");
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => {
      FakeRealtimeConnection.last?.options.onStatus?.({
        slug: SLUG,
        status: "LIVE",
      });
    });

    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledOnce();
    });
  });

  it("says it is watching every 30 seconds while the event is live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveRoom();
    renderScreen(
      <WatchRoom
        info={info({
          status: "LIVE",
          streamUrl: "https://stream.example.com/x.m3u8",
        })}
      />,
    );
    await screen.findByLabelText(/live stream/);
    const connection = FakeRealtimeConnection.last;
    const heartbeats = () =>
      connection?.request.mock.calls.filter(
        ([name]) => name === "watch.heartbeat",
      ).length ?? 0;

    expect(heartbeats()).toBe(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(heartbeats()).toBe(2);
    expect(connection?.request).toHaveBeenLastCalledWith("watch.heartbeat", {
      slug: SLUG,
    });
  });

  it("sends no heartbeat before the event is live", async () => {
    serveRoom();
    renderScreen(<WatchRoom info={info()} />);
    await screen.findByText("Will it ship?");

    expect(FakeRealtimeConnection.last?.request).not.toHaveBeenCalledWith(
      "watch.heartbeat",
      expect.anything(),
    );
  });

  it("votes, and takes the vote back", async () => {
    serveRoom();
    const calls: string[] = [];
    server.use(
      http.put(
        `*/api/v1/public/events/${SLUG}/questions/${QUESTION.id}/vote`,
        () => {
          calls.push("PUT");
          return HttpResponse.json({
            ...QUESTION,
            voteCount: 2,
            votedByMe: true,
          });
        },
      ),
      http.delete(
        `*/api/v1/public/events/${SLUG}/questions/${QUESTION.id}/vote`,
        () => {
          calls.push("DELETE");
          return HttpResponse.json({ ...QUESTION, votedByMe: false });
        },
      ),
    );
    renderScreen(<WatchRoom info={info()} />);
    const user = userEvent.setup();

    const button = await screen.findByRole("button", {
      name: "Vote for: Will it ship?",
    });
    await user.click(button);
    await vi.waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(button);

    await vi.waitFor(() => {
      expect(calls).toEqual(["PUT", "DELETE"]);
    });
  });

  it("asks with an idempotency key", async () => {
    serveRoom();
    const keys: (string | null)[] = [];
    server.use(
      http.post(`*/api/v1/public/events/${SLUG}/questions`, ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return HttpResponse.json(
          {
            ...QUESTION,
            id: "0195f0a0-0000-7000-8000-0000000000a2",
            body: "Mine?",
            mine: true,
          },
          { status: 201 },
        );
      }),
    );
    renderScreen(<WatchRoom info={info()} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Your question"), "Mine?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Mine?")).toBeVisible();
    expect(keys).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  });

  it("says when the attendee has been signed out", async () => {
    serveRoom();
    renderScreen(<WatchRoom info={info()} />);
    await screen.findByText("Will it ship?");

    act(() => {
      FakeRealtimeConnection.last?.options.onState("signed-out");
    });

    expect(
      await screen.findByText("You have been signed out of this event."),
    ).toBeVisible();
  });

  it("says when chat and questions update live, once both are joined", async () => {
    serveRoom();
    renderScreen(<WatchRoom info={info()} />);
    await screen.findByText("Will it ship?");
    expect(screen.getByText("Connecting…")).toBeVisible();

    act(() => {
      FakeRealtimeConnection.last?.options.onJoined?.("CHAT");
    });
    expect(screen.getByText("Connecting…")).toBeVisible();
    act(() => {
      FakeRealtimeConnection.last?.options.onJoined?.("QUESTIONS");
    });

    expect(
      screen.getByText("Live: chat and questions update as they happen."),
    ).toBeVisible();
  });

  it("lets the server decide what the page becomes when the event refuses it", async () => {
    serveRoom();
    renderScreen(<WatchRoom info={info()} />);
    await screen.findByText("Will it ship?");
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => {
      FakeRealtimeConnection.last?.options.onState("refused");
    });

    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledOnce();
    });
  });

  it("keeps a broken chat to the chat: the slate and the questions stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("reportError", vi.fn());
    failing.add("chat");
    try {
      serveRoom();
      renderScreen(<WatchRoom info={info()} />);

      expect(await screen.findByText("Will it ship?")).toBeInTheDocument();
      expect(
        screen.getByText("Something went wrong showing the chat."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: /Product launch/ }),
      ).toBeInTheDocument();
    } finally {
      failing.clear();
      vi.unstubAllGlobals();
    }
  });
});
