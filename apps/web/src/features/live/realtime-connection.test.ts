import type { ChannelJoinAck, ChatEvent } from "@opspilot/contracts";
import type { Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backoff,
  type ConnectionState,
  RealtimeConnection,
} from "./realtime-connection";

type Handler = (...args: unknown[]) => void;

/** Just enough of a Socket.IO client, driven by the test. */
class FakeSocket {
  connected = false;
  active = false;
  connects = 0;
  readonly sent: { name: string; payload: unknown }[] = [];
  private readonly handlers = new Map<string, Handler[]>();
  /** What the server answers each message with. */
  answer: (name: string, payload: unknown) => unknown = () => ({
    ok: true,
    latestSequence: 0,
    replay: [],
  });

  on(name: string, handler: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    return this;
  }

  off(name: string, handler: Handler) {
    this.handlers.set(
      name,
      (this.handlers.get(name) ?? []).filter((each) => each !== handler),
    );
    return this;
  }

  connect() {
    this.connects += 1;
    return this;
  }

  close() {
    this.connected = false;
    return this;
  }

  timeout() {
    return {
      emitWithAck: (name: string, payload: unknown) => {
        this.sent.push({ name, payload });
        if (!this.connected) {
          return Promise.reject(new Error("operation has timed out"));
        }
        return Promise.resolve(this.answer(name, payload));
      },
    };
  }

  /** The server's side: an event arrives at the client. */
  fire(name: string, ...args: unknown[]) {
    if (name === "connect") {
      this.connected = true;
      this.active = true;
    }
    if (name === "disconnect") {
      this.connected = false;
    }
    for (const handler of this.handlers.get(name) ?? []) {
      handler(...args);
    }
  }
}

const message = (sequence: number): ChatEvent => ({
  sequence,
  kind: "MESSAGE_CREATED",
  message: {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    author: { kind: "ATTENDEE", name: "Ada" },
    body: `m${String(sequence)}`,
    deleted: false,
    createdAt: "2026-11-15T12:00:00.000Z",
  },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUp(options: { refreshSession?: () => Promise<boolean> } = {}) {
  const socket = new FakeSocket();
  const states: ConnectionState[] = [];
  const connection = new RealtimeConnection(
    {
      slug: "launch",
      onState: (state) => states.push(state),
      refreshSession: options.refreshSession,
    },
    () => socket as unknown as Socket,
  );
  return { socket, states, connection };
}

const joins = (socket: FakeSocket) =>
  socket.sent.filter(({ name }) => name === "channel.join");

describe("RealtimeConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins after the snapshot, and rejoins from the last sequence after a reconnect", async () => {
    const { socket, connection } = setUp();
    const applied: number[] = [];
    socket.answer = (): ChannelJoinAck => ({
      ok: true,
      latestSequence: 5,
      replay: [message(5)],
    });
    connection.connect();
    socket.fire("connect");

    await connection.follow({
      channel: "CHAT",
      loadSnapshot: () => Promise.resolve(4),
      apply: (event) => applied.push(event.sequence),
    });
    socket.fire("chat.event", message(6));
    socket.fire("chat.event", message(6));
    socket.fire("disconnect", "transport close");
    socket.answer = (): ChannelJoinAck => ({
      ok: true,
      latestSequence: 7,
      replay: [message(7)],
    });
    socket.fire("connect");
    await flush();

    expect(applied).toEqual([5, 6, 7]);
    expect(joins(socket).map(({ payload }) => payload)).toEqual([
      { slug: "launch", channel: "CHAT", afterSequence: 4 },
      { slug: "launch", channel: "CHAT", afterSequence: 6 },
    ]);
  });

  it("reloads the snapshot when the server says it is too far behind", async () => {
    const { socket, connection } = setUp();
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(900);
    let first = true;
    socket.answer = (): ChannelJoinAck => {
      if (first) {
        first = false;
        return { ok: false, error: "RESYNC_REQUIRED" };
      }
      return { ok: true, latestSequence: 900, replay: [] };
    };
    socket.fire("connect");

    await connection.follow({
      channel: "CHAT",
      loadSnapshot: snapshot,
      apply: () => undefined,
    });

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(joins(socket).at(-1)?.payload).toMatchObject({ afterSequence: 900 });
  });

  it("stops when the session is ended, and says so", () => {
    const { socket, states } = setUp();
    socket.fire("connect");

    socket.fire("session.revoked", { reason: "SIGNED_OUT" });
    socket.fire("disconnect", "io server disconnect");

    expect(states.at(-1)).toBe("signed-out");
    expect(socket.connects).toBe(0);
  });

  it("connects again when access changed, and reports a refused join", async () => {
    vi.useFakeTimers();
    const { socket, states, connection } = setUp();
    socket.fire("connect");
    await connection.follow({
      channel: "QUESTIONS",
      loadSnapshot: () => Promise.resolve(0),
      apply: () => undefined,
    });

    socket.fire("session.revoked", { reason: "ACCESS_REVOKED" });
    socket.fire("disconnect", "io server disconnect");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(socket.connects).toBe(1);

    socket.answer = () => ({ ok: false, error: "FORBIDDEN" });
    socket.fire("connect");
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toBe("refused");
  });

  it("renews an expired staff session before connecting again", async () => {
    vi.useFakeTimers();
    const refreshSession = vi.fn().mockResolvedValue(true);
    const { socket, states } = setUp({ refreshSession });

    socket.fire("connect_error", new Error("UNAUTHENTICATED"));
    await vi.advanceTimersByTimeAsync(1_500);

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(socket.connects).toBe(1);
    expect(states).not.toContain("signed-out");
  });

  it("gives up on an attendee's session the server no longer knows", async () => {
    const { socket, states } = setUp();

    socket.fire("connect_error", new Error("UNAUTHENTICATED"));
    await flush();

    expect(states.at(-1)).toBe("signed-out");
    expect(socket.connects).toBe(0);
  });

  it("retries a handshake refused for a passing reason", async () => {
    vi.useFakeTimers();
    const { socket } = setUp();

    socket.fire("connect_error", new Error("RATE_LIMITED"));
    await vi.advanceTimersByTimeAsync(1_500);

    expect(socket.connects).toBe(1);
  });
});

describe("backoff", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("starts at 1 s and doubles to 30 s, with jitter, never above 30 s", () => {
    const middle = () => 0.5;

    expect(
      [0, 1, 2, 3, 4, 5, 9].map((attempt) => backoff(attempt, middle)),
    ).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(backoff(0, () => 0)).toBe(500);
    expect(backoff(9, () => 0.99)).toBe(30_000);
  });
});
