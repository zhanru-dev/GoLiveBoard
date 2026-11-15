import type { ChatMessage, ChatSendAck, Question } from "@opspilot/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RealtimeConnection } from "./realtime-connection";
import {
  applyQuestionsEvent,
  orderQuestions,
  useChat,
  useQuestions,
} from "./use-live";

const question = (id: string, changes: Partial<Question> = {}): Question => ({
  id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
  body: `Question ${id}`,
  status: "PUBLISHED",
  author: { kind: "ATTENDEE", name: "Ada" },
  pinSlot: null,
  voteCount: 0,
  version: 1,
  createdAt: `2026-11-15T12:00:0${id}.000Z`,
  ...changes,
});

const message = (sequence: number, changes: Partial<ChatMessage> = {}) => ({
  id: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  sequence,
  author: { kind: "ATTENDEE" as const, name: "Ada" },
  body: `m${String(sequence)}`,
  deleted: false,
  createdAt: "2026-11-15T12:00:00.000Z",
  ...changes,
});

/** A connection the test drives: what it follows, what it is asked. */
function fakeConnection() {
  const applied: Record<string, (event: never) => void> = {};
  const connectListeners: (() => void)[] = [];
  const request = vi.fn<(name: string, payload: unknown) => Promise<unknown>>();
  const connection = {
    follow: vi.fn(
      async (options: {
        channel: string;
        loadSnapshot: () => Promise<number>;
        apply: (event: never) => void;
      }) => {
        applied[options.channel] = options.apply;
        await options.loadSnapshot();
      },
    ),
    request,
    onConnect: (listener: () => void) => {
      connectListeners.push(listener);
      return () => undefined;
    },
  };
  return {
    connection: connection as unknown as RealtimeConnection,
    request,
    deliver: (channel: string, event: unknown) => {
      act(() => {
        applied[channel]?.(event as never);
      });
    },
    reconnect: () => {
      act(() => {
        for (const listener of connectListeners) {
          listener();
        }
      });
    },
  };
}

describe("applyQuestionsEvent", () => {
  it("keeps what only this viewer knows when a question changes", () => {
    const mine = question("1", { mine: true, votedByMe: true });
    const before = new Map([[mine.id, mine]]);

    const after = applyQuestionsEvent(before, {
      sequence: 2,
      kind: "VOTED",
      question: question("1", { voteCount: 5 }),
    });

    expect(after.get(mine.id)).toMatchObject({
      voteCount: 5,
      mine: true,
      votedByMe: true,
    });
  });

  it("drops a question the viewer may no longer see", () => {
    const shown = question("1");

    const after = applyQuestionsEvent(new Map([[shown.id, shown]]), {
      sequence: 3,
      kind: "WITHDRAWN",
      questionId: shown.id,
    });

    expect(after.size).toBe(0);
  });
});

describe("orderQuestions", () => {
  it("puts pinned questions first by slot, then the most voted, then the oldest", () => {
    const ordered = orderQuestions([
      question("1", { voteCount: 1 }),
      question("2", { voteCount: 9 }),
      question("3", { pinSlot: 2 }),
      question("4", { pinSlot: 1 }),
      question("5", { voteCount: 1 }),
    ]);

    expect(ordered.map(({ body }) => body)).toEqual([
      "Question 4",
      "Question 3",
      "Question 2",
      "Question 1",
      "Question 5",
    ]);
  });
});

describe("useChat", () => {
  it("shows the snapshot and live messages in order, each once", async () => {
    const { connection, deliver } = fakeConnection();
    const { result } = renderHook(() =>
      useChat(connection, "launch", {
        history: () =>
          Promise.resolve({
            items: [message(1), message(2)],
            latestSequence: 2,
            nextBefore: null,
          }),
      }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    deliver("CHAT", {
      sequence: 3,
      kind: "MESSAGE_CREATED",
      message: message(3),
    });
    deliver("CHAT", {
      sequence: 4,
      kind: "MESSAGE_DELETED",
      message: message(2, { body: "", deleted: true }),
    });

    expect(
      result.current.messages.map(({ sequence, deleted }) => [
        sequence,
        deleted,
      ]),
    ).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
  });

  it("sends a failed message again after a reconnect, with the same client message ID", async () => {
    const { connection, request, reconnect } = fakeConnection();
    request.mockRejectedValueOnce(new Error("operation has timed out"));
    const { result } = renderHook(() =>
      useChat(connection, "launch", {
        history: () =>
          Promise.resolve({ items: [], latestSequence: 0, nextBefore: null }),
      }),
    );

    act(() => {
      result.current.send("Hello");
    });
    await waitFor(() => {
      expect(result.current.pending[0]?.failed).toBe(true);
    });
    const stored: ChatSendAck = {
      ok: true,
      message: message(1, { body: "Hello" }),
    };
    request.mockResolvedValueOnce(stored);
    reconnect();

    await waitFor(() => {
      expect(result.current.pending).toEqual([]);
    });
    expect(result.current.messages.map(({ body }) => body)).toEqual(["Hello"]);
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe("chat.send");
    expect(second?.[1]).toEqual(first?.[1]);
  });
});

describe("useQuestions", () => {
  it("merges what the API returns to this viewer into the live list", async () => {
    const { connection } = fakeConnection();
    const { result } = renderHook(() =>
      useQuestions(connection, {
        list: () =>
          Promise.resolve({ items: [question("1")], latestSequence: 1 }),
      }),
    );
    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.merge(question("1", { voteCount: 1, votedByMe: true }));
    });

    expect(result.current.questions[0]).toMatchObject({
      voteCount: 1,
      votedByMe: true,
    });
  });
});
