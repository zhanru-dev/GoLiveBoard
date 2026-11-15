import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  ChannelJoin,
  type ChannelJoinAck,
  ChannelLeave,
  type ChatEvent,
  type ChatSendAck,
  type QuestionsEvent,
  type EventStatus,
  type EventStatusChanged,
  REALTIME_PATH,
  type RealtimeChannel,
  type RealtimeFailure,
  type SessionRevoked,
} from "@opspilot/contracts";
import { createAdapter } from "@socket.io/redis-adapter";
import { parseCookie } from "cookie";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { Server, type Socket } from "socket.io";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { AttendeeSessions } from "../attendees/attendee-sessions.js";
import { publicStatusOf } from "../attendees/domain/admission.js";
import { ActorLoader } from "../auth/actor-loader.js";
import { ACCESS_COOKIE } from "../auth/cookies.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { ROOT_LOGGER } from "../observability/logger.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { ChatService } from "./chat.service.js";
import { clientIp } from "./client-ip.js";
import { Fanout } from "./fanout.js";
import { replayPlan } from "./domain/replay.js";
import { catchRejections } from "./valkey-guard.js";
import { chatReplay, latestSequence, questionsReplay } from "./journal.js";
import {
  type EventRef,
  type Identity,
  type Participant,
  Participants,
} from "./participants.js";
import { authorKey, viewerOf } from "./questions.service.js";
import { RealtimeSignal, signalsChannel } from "./realtime-signals.js";
import {
  authorRoom,
  channelRoom,
  moderatorsRoom,
  type RecheckScope,
  scopeRoom,
} from "./rooms.js";

/** Messages one connection may send per window, whatever they are. */
export const MESSAGES_PER_WINDOW = 30;
export const MESSAGE_WINDOW_MS = 10_000;
/** Open connections per session, across every instance (browser tabs). */
export const CONNECTIONS_PER_SESSION = 10;
/** Connections re-checked at the same time. */
const RECHECK_CONCURRENCY = 16;
/** The largest message a client may send. */
const MAX_MESSAGE_BYTES = 16 * 1024;

interface JoinedEvent {
  /** Undefined while the join is being decided. */
  participant?: Participant;
  readonly channels: Set<RealtimeChannel>;
  /**
   * Set when a re-check refused the event while its join was being decided:
   * the join's own decision may predate the change, so it decides again.
   */
  stale?: boolean;
}

/** What the gateway keeps about each connection. */
export interface ConnectionState {
  identity: Identity;
  /** Correlates this connection's log lines, like a request ID. */
  readonly connectionId: string;
  readonly ip: string;
  /** By event ID. */
  readonly joined: Map<string, JoinedEvent>;
  windowStart: number;
  messagesInWindow: number;
}

export interface ServerToClient {
  "chat.event": (event: ChatEvent) => void;
  "questions.event": (event: QuestionsEvent) => void;
  "event.status": (event: EventStatusChanged) => void;
  "session.revoked": (event: SessionRevoked) => void;
}

export interface ClientToServer {
  "channel.join": (
    payload: unknown,
    ack: (result: ChannelJoinAck) => void,
  ) => void;
  "channel.leave": (
    payload: unknown,
    ack?: (result: { ok: true } | RealtimeFailure) => void,
  ) => void;
  "chat.send": (payload: unknown, ack: (result: ChatSendAck) => void) => void;
}

type RealtimeServer = Server<
  ClientToServer,
  ServerToClient,
  Record<string, never>,
  ConnectionState
>;
type RealtimeSocket = Socket<
  ClientToServer,
  ServerToClient,
  Record<string, never>,
  ConnectionState
>;

/** The Q&A rooms a participant's role adds to the channel's own. */
function questionRooms(participant: Participant): string[] {
  return [
    authorRoom(participant.eventId, authorKey(participant)),
    ...(participant.moderator ? [moderatorsRoom(participant.eventId)] : []),
  ];
}

const failure = (error: RealtimeFailure["error"]): RealtimeFailure => ({
  ok: false,
  error,
});

/**
 * Socket.IO on `/realtime` (docs/04, section 4, ADR-0008).
 *
 * - **Transport:** WebSocket only. Browsers always send Origin on a
 *   WebSocket handshake, so a cross-site page cannot open one with our
 *   cookies; and with no long-polling, instances need no sticky sessions.
 * - **Authentication:** the browser's cookies, a staff session, an attendee
 *   session or both, loaded with the same code as HTTP.
 * - **Access:** decided again on every join, on every signal that concerns
 *   the connection (a revocation reaches every instance through Valkey and
 *   ends the connection within seconds), and every SWEEP_INTERVAL_MS.
 * - **Fan-out:** the Valkey adapter, so a message sent to one instance
 *   reaches clients connected to any.
 */
@Injectable()
export class RealtimeGateway
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private io?: RealtimeServer;
  private readonly connections: Redis[] = [];
  private sweepTimer?: NodeJS.Timeout;
  private readonly logger: Logger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ROOT_LOGGER) rootLogger: Logger,
    private readonly actors: ActorLoader,
    private readonly attendeeSessions: AttendeeSessions,
    private readonly participants: Participants,
    private readonly rateLimiter: RateLimiter,
    private readonly chat: ChatService,
    private readonly fanout: Fanout,
  ) {
    this.logger = rootLogger.child({ context: RealtimeGateway.name });
  }

  /** Starts serving `/realtime` on the API's HTTP server. */
  attach(httpServer: HttpServer): void {
    const io: RealtimeServer = new Server(httpServer, {
      path: REALTIME_PATH,
      transports: ["websocket"],
      serveClient: false,
      maxHttpBufferSize: MAX_MESSAGE_BYTES,
      allowRequest: (request, callback) => {
        callback(null, request.headers.origin === this.config.app.origin);
      },
    });
    io.adapter(
      createAdapter(this.publisher(), this.subscriber("adapter"), {
        key: `${this.config.realtime.channelPrefix}:socket.io`,
      }),
    );
    io.use((socket, next) => {
      this.authenticate(socket).then(
        (error) => {
          next(error === undefined ? undefined : new Error(error));
        },
        (error: unknown) => {
          this.logger.error({ err: error }, "Real-time handshake failed");
          next(new Error("UNAVAILABLE"));
        },
      );
    });
    io.on("connection", (socket) => {
      this.onConnection(socket);
    });
    this.io = io;
    this.fanout.attach(io);
    this.listenForSignals();
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, this.config.realtime.sweepMs);
    this.sweepTimer.unref();
  }

  /**
   * Before Nest closes the HTTP server, which would otherwise wait for every
   * open WebSocket and never finish (a deploy's graceful shutdown).
   * Clients reconnect, with their backoff, to another instance.
   */
  beforeApplicationShutdown(): void {
    clearInterval(this.sweepTimer);
    if (this.io !== undefined) {
      // This instance's clients only: through the adapter, a plain
      // disconnectSockets reaches every instance's.
      this.io.local.disconnectSockets(true);
      // Not io.close(): that closes the HTTP server too, which is Nest's job.
      this.io.engine.close();
    }
  }

  onApplicationShutdown(): void {
    for (const connection of this.connections) {
      connection.disconnect();
    }
  }

  // --- Connections -------------------------------------------------------

  /** @returns the error code to refuse the connection with, if any */
  private async authenticate(
    socket: RealtimeSocket,
  ): Promise<string | undefined> {
    const ip = clientIp(socket.request, this.config.api.trustProxyHops);
    if (
      !(await this.rateLimiter.consume(
        RATE_LIMITS.realtimeConnectionsPerIp,
        ip,
      ))
    ) {
      return "RATE_LIMITED";
    }
    const cookies = parseCookie(socket.request.headers.cookie ?? "");
    const connectionId = randomUUID();
    const accessToken = cookies[ACCESS_COOKIE];
    const attendeeToken = cookies[ATTENDEE_COOKIE];
    const [actor, check] = await Promise.all([
      accessToken === undefined || accessToken === ""
        ? undefined
        : this.actors.load(accessToken, connectionId),
      attendeeToken === undefined || attendeeToken === ""
        ? undefined
        : this.attendeeSessions.byToken(attendeeToken),
    ]);
    const attendee = check?.admitted === true ? check.attendee : undefined;
    if (actor === undefined && attendee === undefined) {
      return check === undefined ? "UNAUTHENTICATED" : "FORBIDDEN";
    }
    const sessionRooms = [
      ...(actor === undefined ? [] : [scopeRoom("session", actor.sessionId)]),
      ...(attendee === undefined
        ? []
        : [scopeRoom("attendee-session", attendee.sessionId)]),
    ];
    for (const room of sessionRooms) {
      if ((await this.countIn(room)) >= CONNECTIONS_PER_SESSION) {
        return "RATE_LIMITED";
      }
    }
    socket.data = {
      identity: {
        staffSessionId: actor?.sessionId,
        attendeeSessionId: attendee?.sessionId,
      },
      connectionId,
      ip,
      joined: new Map(),
      windowStart: Date.now(),
      messagesInWindow: 0,
    };
    await socket.join([
      ...sessionRooms,
      ...(actor === undefined ? [] : [scopeRoom("user", actor.userId)]),
      ...(attendee === undefined
        ? []
        : [scopeRoom("attendee", attendee.attendeeId)]),
    ]);
    return undefined;
  }

  /** Connections in a room on every instance; this one's if Valkey fails. */
  private async countIn(room: string): Promise<number> {
    const io = this.requireServer();
    try {
      return (await io.in(room).fetchSockets()).length;
    } catch {
      return io.local
        .in(room)
        .fetchSockets()
        .then((found) => found.length);
    }
  }

  private onConnection(socket: RealtimeSocket): void {
    // A revocation that committed while the handshake ran sent its signal
    // before this connection was in any room: decide once more, now that
    // every later signal reaches it.
    void this.recheck(socket).catch((error: unknown) => {
      this.logger.error(
        { err: error, connectionId: socket.data.connectionId },
        "Real-time re-check failed",
      );
    });
    socket.on("channel.join", (payload, ack) => {
      if (typeof ack !== "function") {
        return;
      }
      this.handle(socket, ack, () => this.join(socket, payload));
    });
    socket.on("chat.send", (payload, ack) => {
      if (typeof ack !== "function") {
        return;
      }
      const { identity, connectionId, ip } = socket.data;
      this.handle(socket, ack, () =>
        this.chat.send({ identity, connectionId, ip }, payload),
      );
    });
    socket.on("channel.leave", (payload, ack) => {
      const respond = typeof ack === "function" ? ack : () => undefined;
      this.handle(socket, respond, () => this.leave(socket, payload));
    });
  }

  /** Runs a handler with the per-connection message limit and error handling. */
  private handle<T>(
    socket: RealtimeSocket,
    ack: (result: T | RealtimeFailure) => void,
    run: () => Promise<T | RealtimeFailure>,
  ): void {
    if (!this.withinMessageLimit(socket.data)) {
      ack(failure("RATE_LIMITED"));
      return;
    }
    run().then(ack, (error: unknown) => {
      this.logger.error(
        { err: error, connectionId: socket.data.connectionId },
        "Real-time message failed",
      );
      ack(failure("UNAVAILABLE"));
    });
  }

  private withinMessageLimit(state: ConnectionState): boolean {
    const now = Date.now();
    if (now - state.windowStart >= MESSAGE_WINDOW_MS) {
      state.windowStart = now;
      state.messagesInWindow = 0;
    }
    state.messagesInWindow += 1;
    return state.messagesInWindow <= MESSAGES_PER_WINDOW;
  }

  // --- Channels ----------------------------------------------------------

  private async join(
    socket: RealtimeSocket,
    payload: unknown,
  ): Promise<ChannelJoinAck> {
    const parsed = ChannelJoin.safeParse(payload);
    if (!parsed.success) {
      return failure("INVALID");
    }
    const { slug, channel, afterSequence } = parsed.data;
    const event = await this.prisma.event.findUnique({
      where: { slug },
      select: { id: true, workspaceId: true },
    });
    if (event === null) {
      return failure("NOT_FOUND");
    }
    // In the rooms first, then decide: a change that commits after the
    // decision has read the database sends a signal this connection
    // receives, and the re-check it causes covers this event too.
    const rooms = [
      scopeRoom("event", event.id),
      scopeRoom("workspace", event.workspaceId),
      channelRoom(event.id, channel),
    ];
    const state = socket.data;
    const existing = state.joined.get(event.id);
    const joined = existing ?? { channels: new Set<RealtimeChannel>() };
    state.joined.set(event.id, joined);
    await socket.join(rooms);
    let access = await this.participants.authorize(
      state.identity,
      { id: event.id },
      state.connectionId,
    );
    if (access.ok && joined.stale === true) {
      joined.stale = false;
      access = await this.participants.authorize(
        state.identity,
        { id: event.id },
        state.connectionId,
      );
    }
    if (!access.ok) {
      if (existing === undefined) {
        state.joined.delete(event.id);
        // The workspace's room may serve another event; staying in it only
        // costs an extra re-check now and then.
        await socket.leave(scopeRoom("event", event.id));
        await socket.leave(channelRoom(event.id, channel));
      }
      return failure(access.error);
    }
    const { participant } = access;
    joined.participant = participant;
    joined.channels.add(channel);
    if (channel === "QUESTIONS") {
      // Before the latest sequence is read: a change committed after that
      // read reaches this connection as its role may see it.
      await socket.join(questionRooms(participant));
    }

    const latest = await latestSequence(this.prisma, event.id, channel);
    const plan = replayPlan(afterSequence, latest);
    if (plan.kind === "RESYNC") {
      return failure("RESYNC_REQUIRED");
    }
    if (plan.kind === "UP_TO_DATE") {
      return { ok: true, latestSequence: latest, replay: [] };
    }
    const replay =
      channel === "CHAT"
        ? await chatReplay(this.prisma, event.id, afterSequence, latest)
        : await questionsReplay(
            this.prisma,
            event.id,
            afterSequence,
            latest,
            viewerOf(participant),
          );
    return { ok: true, latestSequence: latest, replay };
  }

  private async leave(
    socket: RealtimeSocket,
    payload: unknown,
  ): Promise<{ ok: true } | RealtimeFailure> {
    const parsed = ChannelLeave.safeParse(payload);
    if (!parsed.success) {
      return failure("INVALID");
    }
    const { slug, channel } = parsed.data;
    for (const [eventId, joined] of socket.data.joined) {
      if (joined.participant?.slug === slug && joined.channels.has(channel)) {
        joined.channels.delete(channel);
        await socket.leave(channelRoom(eventId, channel));
        if (channel === "QUESTIONS") {
          for (const room of questionRooms(joined.participant)) {
            await socket.leave(room);
          }
        }
        if (joined.channels.size === 0) {
          socket.data.joined.delete(eventId);
          await socket.leave(scopeRoom("event", eventId));
        }
      }
    }
    return { ok: true };
  }

  // --- Access re-checks --------------------------------------------------

  private listenForSignals(): void {
    const subscriber = this.subscriber("signals");
    const channelName = signalsChannel(this.config);
    void subscriber.subscribe(channelName);
    subscriber.on("message", (channel: string, message: string) => {
      if (channel !== channelName) {
        return;
      }
      void this.onSignal(message);
    });
    // Signals sent while the subscription was down are lost: catch up.
    let connectedBefore = false;
    subscriber.on("ready", () => {
      if (connectedBefore) {
        void this.sweep();
      }
      connectedBefore = true;
    });
  }

  private async onSignal(message: string): Promise<void> {
    let signal: RealtimeSignal;
    try {
      signal = RealtimeSignal.parse(JSON.parse(message));
    } catch (error) {
      this.logger.warn({ err: error }, "Ignored a malformed real-time signal");
      return;
    }
    try {
      if (signal.type === "status") {
        await this.onStatus(signal.eventId, signal.status);
      } else {
        await this.recheckScope(signal.scope, signal.ids);
      }
    } catch (error) {
      this.logger.error({ err: error }, "Could not act on a real-time signal");
    }
  }

  private async onStatus(eventId: string, status: EventStatus): Promise<void> {
    const io = this.requireServer();
    const sockets = await io.local
      .in(scopeRoom("event", eventId))
      .fetchSockets();
    const slug = sockets
      .map((socket) => socket.data.joined.get(eventId)?.participant?.slug)
      .find((candidate) => candidate !== undefined);
    if (slug !== undefined) {
      // Local only: every instance receives the signal and tells its own.
      io.local
        .to(scopeRoom("event", eventId))
        .emit("event.status", { slug, status: publicStatusOf(status) });
    }
    await this.recheckScope("event", [eventId]);
  }

  private async recheckScope(
    scope: RecheckScope,
    ids: readonly string[],
  ): Promise<void> {
    const io = this.requireServer();
    const sockets = await io.local
      .in(ids.map((id) => scopeRoom(scope, id)))
      .fetchSockets();
    await this.recheckAll(sockets.map((socket) => socket.id));
  }

  /** Re-checks every connection on this instance. */
  private async sweep(): Promise<void> {
    if (this.io === undefined) {
      return;
    }
    try {
      await this.recheckAll([...this.io.of("/").sockets.keys()]);
    } catch (error) {
      this.logger.error({ err: error }, "Real-time sweep failed");
    }
  }

  private async recheckAll(socketIds: readonly string[]): Promise<void> {
    const queue = [...socketIds];
    const workers = Array.from(
      { length: Math.min(RECHECK_CONCURRENCY, queue.length) },
      async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const socket = this.io?.of("/").sockets.get(id);
          if (socket?.connected === true) {
            await this.recheck(socket);
          }
        }
      },
    );
    await Promise.all(workers);
  }

  /**
   * Decides again whether a connection may stay: its sessions, then each
   * event it joined. One that may not is told why and disconnected; the
   * client reconnects, and is refused, or rejoins what it still may.
   */
  private async recheck(socket: RealtimeSocket): Promise<void> {
    const state = socket.data;
    const live = await this.participants.reload(
      state.identity,
      state.connectionId,
    );
    if (typeof live === "string") {
      this.revoke(socket, live);
      return;
    }
    state.identity = live.identity;
    for (const [eventId, joined] of state.joined) {
      const ref: EventRef = { id: eventId };
      const access = await this.participants.authorize(
        state.identity,
        ref,
        state.connectionId,
      );
      if (!access.ok) {
        if (joined.participant === undefined) {
          // A join still being decided: refusing it is the join's answer,
          // not a reason to end the connection.
          joined.stale = true;
          continue;
        }
        this.revoke(
          socket,
          access.error === "UNAUTHENTICATED" ? "SIGNED_OUT" : "ACCESS_REVOKED",
        );
        return;
      }
      const before = joined.participant;
      if (before !== undefined) {
        // On Q&A the role decides what the connection sees (pending and
        // hidden questions, its author's room): a new role starts afresh.
        if (
          joined.channels.has("QUESTIONS") &&
          (before.moderator !== access.participant.moderator ||
            authorKey(before) !== authorKey(access.participant))
        ) {
          this.revoke(socket, "ACCESS_REVOKED");
          return;
        }
        joined.participant = access.participant;
      }
    }
  }

  private revoke(socket: RealtimeSocket, reason: SessionRevoked["reason"]) {
    socket.emit("session.revoked", { reason });
    socket.disconnect(true);
  }

  // --- Plumbing ----------------------------------------------------------

  private requireServer(): RealtimeServer {
    if (this.io === undefined) {
      throw new Error("RealtimeGateway.attach was not called");
    }
    return this.io;
  }

  /**
   * The adapter's publishing connection. Commands fail at once while Valkey
   * is down rather than queue. Delivery to this instance's clients goes on;
   * clients elsewhere notice the gap in the sequence and catch up when they
   * join again.
   */
  private publisher(): Redis {
    return this.track(
      new Redis(this.config.valkey.url, {
        connectionName: "opspilot-realtime-pub",
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }),
    );
  }

  /**
   * A subscribing connection. Subscriptions are queued until it connects
   * and restored after each reconnect.
   */
  private subscriber(name: string): Redis {
    return this.track(
      new Redis(this.config.valkey.url, {
        connectionName: `opspilot-realtime-${name}`,
      }),
    );
  }

  private track(client: Redis): Redis {
    // The adapter does not wait for these; see catchRejections.
    catchRejections(
      client,
      ["publish", "subscribe", "psubscribe"],
      (method, error) => {
        this.logger.warn(
          { err: error, method },
          "Real-time Valkey command failed",
        );
      },
    );
    let available = true;
    client.on("error", (error) => {
      if (available) {
        available = false;
        this.logger.error({ err: error }, "Real-time Valkey connection failed");
      }
    });
    client.on("ready", () => {
      available = true;
    });
    this.connections.push(client);
    return client;
  }
}
