import type { WatchInfo } from "@goliveboard/contracts";
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
import type * as PlayerModule from "./player";
import type * as QuestionsPanelModule from "./questions-panel";

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

vi.mock("./player", async (importOriginal) => {
  const actual = await importOriginal<typeof PlayerModule>();
  return {
    ...actual,
    Player: (props: Parameters<typeof actual.Player>[0]) => {
      if (failing.has("video")) {
        throw new Error("The video could not render");
      }
      return actual.Player(props);
    },
  };
});
vi.mock("./questions-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof QuestionsPanelModule>();
  return {
    ...actual,
    QuestionsPanel: (props: Parameters<typeof actual.QuestionsPanel>[0]) => {
      if (failing.has("questions")) {
        throw new Error("The questions could not render");
      }
      return actual.QuestionsPanel(props);
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

const POLL = {
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  question: "Which demo next?",
  status: "OPEN",
  options: [
    {
      id: "0195f0a0-0000-7000-8000-0000000000b1",
      label: "Dashboards",
      votes: 0,
    },
    { id: "0195f0a0-0000-7000-8000-0000000000b2", label: "Webhooks", votes: 1 },
  ],
  totalVotes: 1,
  version: 3,
  openedAt: "2026-11-27T18:00:00.000Z",
  closedAt: null,
  createdAt: "2026-11-27T17:50:00.000Z",
  myOptionId: null,
};

/** Serves the polls in turn, the last one from then on. */
function servePolls(...lists: object[][]) {
  let served = 0;
  server.use(
    http.get(`*/api/v1/public/events/${SLUG}/polls`, () => {
      const items = lists[Math.min(served, lists.length - 1)];
      served += 1;
      return HttpResponse.json({ items });
    }),
  );
}

function serveRoom() {
  server.use(
    http.get(`*/api/v1/public/events/${SLUG}/chat/messages`, () =>
      HttpResponse.json({ items: [], latestSequence: 0, nextBefore: null }),
    ),
    http.get(`*/api/v1/public/events/${SLUG}/questions`, () =>
      HttpResponse.json({ items: [QUESTION], latestSequence: 1 }),
    ),
    http.get(`*/api/v1/public/events/${SLUG}/polls`, () =>
      HttpResponse.json({ items: [] }),
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

  it("shows a poll's result once the event's end closes it", async () => {
    serveRoom();
    servePolls([POLL], [{ ...POLL, status: "CLOSED", version: 4 }]);
    renderScreen(<WatchRoom info={info({ status: "LIVE" })} />);
    expect(
      await screen.findByRole("heading", { name: "Live poll" }),
    ).toBeVisible();

    act(() => {
      FakeRealtimeConnection.last?.options.onStatus?.({
        slug: SLUG,
        status: "ENDED",
      });
    });

    expect(
      await screen.findByRole("heading", { name: "Poll results" }),
    ).toBeVisible();
  });

  it("shows the answer already given elsewhere, rather than a form that cannot be sent", async () => {
    serveRoom();
    servePolls([POLL], [{ ...POLL, myOptionId: POLL.options[0]?.id }]);
    server.use(
      http.put(`*/api/v1/public/events/${SLUG}/polls/${POLL.id}/vote`, () =>
        HttpResponse.json(
          {
            code: "POLL_ALREADY_VOTED",
            status: 409,
            title: "You have already answered this poll",
          },
          { status: 409 },
        ),
      ),
    );
    renderScreen(<WatchRoom info={info({ status: "LIVE" })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: "Webhooks" }));
    await user.click(screen.getByRole("button", { name: "Send answer" }));

    expect(await screen.findByText("Dashboards · Your answer")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You have already answered this poll",
    );
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

  it("keeps a broken video to the video: the chat and the questions stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("reportError", vi.fn());
    failing.add("video");
    try {
      serveRoom();
      renderScreen(<WatchRoom info={info()} />);

      expect(await screen.findByText("Will it ship?")).toBeInTheDocument();
      expect(
        screen.getByText("Something went wrong showing the video."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /chat/i }),
      ).toBeInTheDocument();
    } finally {
      failing.clear();
      vi.unstubAllGlobals();
    }
  });

  it("keeps broken questions to the questions: the video and the chat stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("reportError", vi.fn());
    failing.add("questions");
    try {
      serveRoom();
      renderScreen(<WatchRoom info={info()} />);

      expect(
        await screen.findByText("Something went wrong showing the questions."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /chat/i }),
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
