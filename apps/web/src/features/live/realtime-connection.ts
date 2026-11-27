import type {
  ChannelJoinAck,
  ChatEvent,
  EventStatusChanged,
  Poll,
  PollUpdated,
  QuestionsEvent,
  RealtimeChannel,
  RealtimeErrorCode,
  SessionRevoked,
} from "@goliveboard/contracts";
import { io, type Socket } from "socket.io-client";

import { ChannelSequence } from "./channel-sequence";

/** docs/04, section 4: the gateway's path on the page's own origin. */
const REALTIME_PATH = "/realtime";
/** Reconnect after 1 s, doubling to 30 s, with jitter. */
const BACKOFF_FIRST_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** How long the server has to answer a message. */
export const ACK_TIMEOUT_MS = 10_000;

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  /** The session ended: signed out, expired or revoked. */
  | "signed-out"
  /** Signed in, but this event is no longer open to this person. */
  | "refused";

interface ChannelEvents {
  CHAT: ChatEvent;
  QUESTIONS: QuestionsEvent;
}

export interface ChannelOptions<C extends RealtimeChannel> {
  readonly channel: C;
  /**
   * Loads the channel's snapshot over HTTP and returns the sequence it ends
   * at. Called first, and again when the server says the client is too far
   * behind (RESYNC_REQUIRED).
   */
  readonly loadSnapshot: () => Promise<number>;
  readonly apply: (event: ChannelEvents[C]) => void;
}

export interface ConnectionOptions {
  readonly slug: string;
  readonly onState: (state: ConnectionState) => void;
  readonly onStatus?: (event: EventStatusChanged) => void;
  /** A channel's join was answered: its events now arrive live. */
  readonly onJoined?: (channel: RealtimeChannel) => void;
  /**
   * Renews an expired staff session; true when it worked. Attendees have
   * nothing to renew: their session lasts until the event ends.
   */
  readonly refreshSession?: () => Promise<boolean>;
  /**
   * The connection could not be made (not refused: unreachable) or was
   * lost; reported as a browser signal (browser-telemetry.ts).
   */
  readonly onFailure?: (reason: "connect-failed" | "lost") => void;
}

interface Joined {
  readonly options: ChannelOptions<RealtimeChannel>;
  readonly sequence: ChannelSequence<ChatEvent | QuestionsEvent>;
  ready: boolean;
}

/**
 * One page's real-time connection to one event (docs/04, section 4): it
 * joins channels after their HTTP snapshot, applies every event exactly
 * once and in order, rejoins after a reconnect from the last sequence it
 * applied, and tells the page when the session or access has ended.
 */
export class RealtimeConnection {
  private readonly socket: Socket;
  private readonly channels = new Map<RealtimeChannel, Joined>();
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly options: ConnectionOptions,
    createSocket: (path: string) => Socket = defaultSocket,
  ) {
    this.socket = createSocket(REALTIME_PATH);
    this.socket.on("connect", () => {
      this.attempts = 0;
      this.options.onState("connected");
      for (const channel of this.channels.values()) {
        if (channel.ready) {
          void this.join(channel);
        }
      }
    });
    this.socket.on("disconnect", (reason) => {
      if (this.closed) {
        return;
      }
      if (reason === "io server disconnect") {
        // The server ended it; session.revoked said why, or it shut down.
        this.scheduleReconnect();
        return;
      }
      this.options.onFailure?.("lost");
      this.options.onState("reconnecting");
    });
    this.socket.on("connect_error", (error) => {
      void this.onRefused(error.message);
    });
    // Gathered by the server: several in one frame, in order.
    this.socket.on("chat.events", (events: ChatEvent[]) => {
      const chat = this.channels.get("CHAT");
      for (const event of events) {
        chat?.sequence.receive(event);
      }
    });
    this.socket.on("questions.event", (event: QuestionsEvent) => {
      this.channels.get("QUESTIONS")?.sequence.receive(event);
    });
    this.socket.on("event.status", (event: EventStatusChanged) => {
      this.options.onStatus?.(event);
    });
    this.socket.on("session.revoked", (event: SessionRevoked) => {
      this.onRevoked(event.reason);
    });
  }

  /** Opens the connection. */
  connect(): void {
    this.options.onState("connecting");
    this.socket.connect();
  }

  /** Follows a channel: its snapshot first, then the server's events. */
  async follow<C extends RealtimeChannel>(
    options: ChannelOptions<C>,
  ): Promise<void> {
    const joined: Joined = {
      options: options as unknown as ChannelOptions<RealtimeChannel>,
      sequence: new ChannelSequence<ChatEvent | QuestionsEvent>(
        (event) => {
          (options.apply as (event: ChatEvent | QuestionsEvent) => void)(event);
        },
        () => void this.join(joined),
      ),
      ready: false,
    };
    this.channels.set(options.channel, joined);
    joined.sequence.reset(await options.loadSnapshot());
    joined.ready = true;
    if (this.socket.connected) {
      await this.join(joined);
    }
  }

  /** Sends a message and waits for the server's answer. */
  async request<T>(name: string, payload: unknown): Promise<T> {
    return (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(name, payload)) as T;
  }

  /**
   * Calls `listener` with every poll the server announces (`poll.updated`):
   * the whole poll, to keep if its version is newer (FR-RN-8).
   */
  onPoll(listener: (poll: Poll) => void): () => void {
    const handler = (message: PollUpdated) => {
      listener(message.poll);
    };
    this.socket.on("poll.updated", handler);
    return () => {
      this.socket.off("poll.updated", handler);
    };
  }

  /** Calls `listener` whenever the connection (re)connects. */
  onConnect(listener: () => void): () => void {
    this.socket.on("connect", listener);
    return () => {
      this.socket.off("connect", listener);
    };
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    for (const channel of this.channels.values()) {
      channel.sequence.dispose();
    }
    this.socket.close();
  }

  private async join(joined: Joined): Promise<void> {
    const { channel } = joined.options;
    joined.sequence.joinStarted();
    let ack: ChannelJoinAck;
    try {
      ack = await this.request<ChannelJoinAck>("channel.join", {
        slug: this.options.slug,
        channel,
        afterSequence: joined.sequence.latest,
      });
    } catch {
      // No answer: the connection dropped. Joining again on reconnect.
      return;
    }
    if (ack.ok) {
      joined.sequence.joined(ack.latestSequence, ack.replay);
      this.options.onJoined?.(channel);
      return;
    }
    if (ack.error === "RESYNC_REQUIRED") {
      joined.sequence.reset(await joined.options.loadSnapshot());
      await this.join(joined);
      return;
    }
    this.onJoinRefused(ack.error);
  }

  private onJoinRefused(error: RealtimeErrorCode): void {
    if (error === "UNAUTHENTICATED") {
      this.options.onState("signed-out");
    } else if (
      error === "FORBIDDEN" ||
      error === "NOT_FOUND" ||
      error === "CLOSED"
    ) {
      this.options.onState("refused");
    }
    // RATE_LIMITED, UNAVAILABLE: the next reconnect tries again.
  }

  private onRevoked(reason: SessionRevoked["reason"]): void {
    // ACCESS_REVOKED can mean a new role, not no role: connecting again
    // finds out, and the joins say if nothing is left.
    if (reason === "SIGNED_OUT") {
      this.closed = true;
      this.options.onState("signed-out");
    }
  }

  private async onRefused(code: string): Promise<void> {
    if (this.closed) {
      return;
    }
    if (code !== "UNAUTHENTICATED" && code !== "FORBIDDEN") {
      // Not a refusal: the server could not be reached, or answered with
      // something other than a decision.
      this.options.onFailure?.("connect-failed");
    }
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
      const renewed =
        code === "UNAUTHENTICATED" &&
        this.options.refreshSession !== undefined &&
        (await this.options.refreshSession());
      if (!renewed) {
        this.closed = true;
        this.options.onState(code === "FORBIDDEN" ? "refused" : "signed-out");
        return;
      }
    }
    // A refused handshake is not retried by Socket.IO itself.
    if (!this.socket.active) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    this.options.onState("reconnecting");
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.socket.connect();
    }, backoff(this.attempts));
    this.attempts += 1;
  }
}

/**
 * 1 s doubling to 30 s, each with up to half of it added or removed (so
 * clients that lost the same server do not all come back at once), never
 * more than 30 s.
 */
export function backoff(attempt: number, random: () => number = Math.random) {
  const base = Math.min(BACKOFF_FIRST_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return Math.min(Math.round(base * (0.5 + random())), BACKOFF_MAX_MS);
}

function defaultSocket(path: string): Socket {
  return io({
    path,
    transports: ["websocket"],
    autoConnect: false,
    reconnectionDelay: BACKOFF_FIRST_MS,
    reconnectionDelayMax: BACKOFF_MAX_MS,
    randomizationFactor: 0.5,
  });
}
