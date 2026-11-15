import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  type ChannelJoinAck,
  type ChatEvent,
  type ChatSendAck,
  type EventStatusChanged,
  REALTIME_PATH,
  type SessionRevoked,
} from "@opspilot/contracts";
import { io, type Socket } from "socket.io-client";

import { TEST_ORIGIN } from "./config.js";

/** Starts the app's HTTP server on a free port; returns its base URL. */
export async function listen(app: NestExpressApplication): Promise<string> {
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

export interface ConnectOptions {
  readonly cookie?: string;
  readonly origin?: string;
  /** Announced through X-Forwarded-For, as Caddy does. */
  readonly ip?: string;
}

/**
 * A real-time client as the browser's: WebSocket only, cookies and Origin
 * sent with the handshake. It records everything the server sends and never
 * reconnects on its own.
 */
export class RealtimeClient {
  readonly chat: ChatEvent[] = [];
  readonly statuses: EventStatusChanged[] = [];
  readonly revoked: SessionRevoked[] = [];
  private readonly socket: Socket;
  private disconnectedAt?: number;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("chat.event", (event: ChatEvent) => this.chat.push(event));
    socket.on("event.status", (event: EventStatusChanged) =>
      this.statuses.push(event),
    );
    socket.on("session.revoked", (event: SessionRevoked) =>
      this.revoked.push(event),
    );
    socket.on("disconnect", () => {
      this.disconnectedAt = Date.now();
    });
  }

  /**
   * Connects; resolves once the server accepted the connection.
   *
   * @throws the server's refusal (its message is the error code)
   */
  static async connect(
    url: string,
    options: ConnectOptions = {},
  ): Promise<RealtimeClient> {
    const headers: Record<string, string> = {
      Origin: options.origin ?? TEST_ORIGIN,
    };
    if (options.cookie !== undefined) {
      headers.Cookie = options.cookie;
    }
    if (options.ip !== undefined) {
      headers["X-Forwarded-For"] = options.ip;
    }
    const socket = io(url, {
      path: REALTIME_PATH,
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      extraHeaders: headers,
      timeout: 5_000,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        resolve();
      });
      socket.once("connect_error", (error) => {
        socket.close();
        reject(error);
      });
    });
    return new RealtimeClient(socket);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /** When the server ended the connection; undefined while it is open. */
  get disconnectedAtMs(): number | undefined {
    return this.disconnectedAt;
  }

  join(
    slug: string,
    afterSequence = 0,
    channel: "CHAT" | "QUESTIONS" = "CHAT",
  ): Promise<ChannelJoinAck> {
    return this.socket.timeout(5_000).emitWithAck("channel.join", {
      slug,
      channel,
      afterSequence,
    }) as Promise<ChannelJoinAck>;
  }

  /** Sends a chat message; a retry passes the same client message ID. */
  send(
    slug: string,
    body: string,
    clientMessageId: string = randomUUID(),
  ): Promise<ChatSendAck> {
    return this.socket.timeout(5_000).emitWithAck("chat.send", {
      slug,
      clientMessageId,
      body,
    }) as Promise<ChatSendAck>;
  }

  /** Sends anything, for tests of what the server refuses. */
  emit(name: string, payload: unknown): Promise<unknown> {
    return this.socket.timeout(5_000).emitWithAck(name, payload);
  }

  /** Resolves when the server has disconnected this client. */
  async untilDisconnected(timeoutMs: number): Promise<void> {
    if (!this.socket.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Still connected after ${String(timeoutMs)} ms`));
      }, timeoutMs);
      this.socket.once("disconnect", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
