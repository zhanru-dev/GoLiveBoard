import { type BeforeApplicationShutdown, Injectable } from "@nestjs/common";
import type { LiveOps } from "@opspilot/contracts";
import type { Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import type { Actor } from "../auth/actor.js";
import { ActorLoader } from "../auth/actor-loader.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { changesBetween, type Told, toldAfter } from "./domain/changes.js";
import { LiveOpsService } from "./live-ops.service.js";

/** How often a stream looks; replaced in tests. */
@Injectable()
export class LiveOpsTiming {
  /** Changes reach the browser within this, plus a query (FR-RN-7: 2 s). */
  readonly lookEveryMs: number = 1_000;
  /** docs/04 section 5: audience and rates every 30 s. */
  readonly figuresEveryMs: number = 30_000;
  /** docs/04 section 5: a comment every 15 s keeps proxies from closing. */
  readonly keepAliveEveryMs: number = 15_000;
}

/** Open streams per staff session, on one instance. */
export const STREAMS_PER_SESSION = 5;
/** A browser this far behind is dropped; it reconnects with a snapshot. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

interface OpenStream {
  readonly actor: Actor;
  readonly eventId: string;
  readonly response: Response;
  nextId: number;
  told: Told;
  lastFigures: number;
  lastWrite: number;
  timer: NodeJS.Timeout | undefined;
  closed: boolean;
}

/**
 * The operations room's server-sent events (docs/04 section 5). Each stream
 * looks at the database every second, from whichever instance holds it:
 *
 * - it re-checks the viewer's session, membership and workspace and that
 *   the event is still theirs, and ends the stream as soon as one fails;
 * - it sends a new stream check's result, incidents opened or resolved, and
 *   a fresh `snapshot` when the event's status changed;
 * - every 30 s the audience and the rates; every 15 s without anything
 *   else, a comment line.
 *
 * Nothing is replayed: a browser that reconnects with `Last-Event-ID` gets
 * a fresh snapshot, numbered after the ID it last saw.
 */
@Injectable()
export class LiveOpsStreams implements BeforeApplicationShutdown {
  private readonly open = new Set<OpenStream>();

  constructor(
    private readonly liveOps: LiveOpsService,
    private readonly actors: ActorLoader,
    private readonly timing: LiveOpsTiming,
    @InjectPinoLogger(LiveOpsStreams.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Answers with the snapshot and keeps the response open.
   *
   * @throws DomainError NOT_FOUND, or RATE_LIMITED past the session's
   * streams, before anything is written
   */
  async start(
    actor: Actor,
    eventId: string,
    lastEventId: string | undefined,
    response: Response,
  ): Promise<void> {
    const snapshot = await this.liveOps.snapshot(actor, eventId);
    // Counted after the last await, so counting and adding are one step.
    const mine = [...this.open].filter(
      (stream) => stream.actor.sessionId === actor.sessionId,
    );
    if (mine.length >= STREAMS_PER_SESSION) {
      throw new DomainError("RATE_LIMITED");
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      // No proxy may hold the stream back to compress or cache it.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const now = Date.now();
    const stream: OpenStream = {
      actor,
      eventId,
      response,
      nextId: firstId(lastEventId),
      told: toldOf(snapshot),
      lastFigures: now,
      lastWrite: now,
      timer: undefined,
      closed: false,
    };
    this.open.add(stream);
    response.on("close", () => {
      this.close(stream);
    });
    // Tells the browser to wait 2 s before reconnecting.
    response.write("retry: 2000\n\n");
    this.send(stream, "snapshot", snapshot);
    this.schedule(stream);
  }

  /** How many streams are open on this instance (for tests). */
  get size(): number {
    return this.open.size;
  }

  /** Before the HTTP server closes, which waits for open responses. */
  beforeApplicationShutdown(): void {
    for (const stream of this.open) {
      this.close(stream);
    }
  }

  private schedule(stream: OpenStream): void {
    if (stream.closed) {
      return;
    }
    stream.timer = setTimeout(() => {
      void this.look(stream).then(
        (keepOpen) => {
          if (keepOpen) {
            this.schedule(stream);
          } else {
            this.close(stream);
          }
        },
        (error: unknown) => {
          // The browser reconnects and starts again from a snapshot.
          this.logger.warn(
            { err: error, eventId: stream.eventId },
            "Operations-room stream failed; closed",
          );
          this.close(stream);
        },
      );
    }, this.timing.lookEveryMs);
  }

  /** @returns false when the viewer may no longer see the event */
  private async look(stream: OpenStream): Promise<boolean> {
    const { actor, eventId } = stream;
    const viewer = await this.actors.loadSession(
      actor.sessionId,
      actor.requestId,
    );
    if (viewer?.workspaceId !== actor.workspaceId) {
      return false;
    }
    const state = await this.liveOps.state(actor.workspaceId, eventId);
    if (state === undefined || stream.closed) {
      return false;
    }
    for (const change of changesBetween(stream.told, state)) {
      switch (change.kind) {
        case "SNAPSHOT": {
          const snapshot = await this.liveOps.snapshot(viewer, eventId);
          this.send(stream, "snapshot", snapshot);
          stream.told = toldOf(snapshot);
          return true;
        }
        case "STREAM_STATUS": {
          const status = await this.liveOps.streamStatus(eventId);
          this.send(stream, "stream.status", status);
          break;
        }
        case "INCIDENT_OPENED":
          this.send(stream, "incident.opened", change.incident);
          break;
        case "INCIDENT_RESOLVED":
          this.send(stream, "incident.resolved", change.incident);
          break;
      }
    }
    stream.told = toldAfter(state);
    const now = Date.now();
    if (now - stream.lastFigures >= this.timing.figuresEveryMs) {
      stream.lastFigures = now;
      const [audience, rates] = await Promise.all([
        this.liveOps.audience(eventId),
        this.liveOps.rates(eventId),
      ]);
      this.send(stream, "audience.updated", audience);
      this.send(stream, "rates.updated", rates);
    }
    if (now - stream.lastWrite >= this.timing.keepAliveEveryMs) {
      this.write(stream, ": keep-alive\n\n");
    }
    return !stream.closed;
  }

  private send(stream: OpenStream, event: string, data: unknown): void {
    const id = stream.nextId;
    stream.nextId += 1;
    // JSON has no raw newline, so the data is one line.
    this.write(
      stream,
      `id: ${String(id)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }

  private write(stream: OpenStream, text: string): void {
    if (stream.closed) {
      return;
    }
    if (stream.response.writableLength > MAX_BUFFERED_BYTES) {
      this.close(stream);
      return;
    }
    stream.response.write(text);
    stream.lastWrite = Date.now();
  }

  private close(stream: OpenStream): void {
    if (stream.closed) {
      return;
    }
    stream.closed = true;
    clearTimeout(stream.timer);
    this.open.delete(stream);
    stream.response.end();
  }
}

function toldOf(snapshot: LiveOps): Told {
  return toldAfter({
    status: snapshot.event.status,
    checkedAt: snapshot.stream?.checkedAt ?? null,
    // The snapshot lists open incidents; resolved ones are in its timeline.
    incidents: [
      ...snapshot.incidents,
      ...snapshot.timeline.flatMap((moment) =>
        moment.kind === "INCIDENT_RESOLVED"
          ? [
              {
                id: moment.incidentId,
                kind: moment.incidentKind,
                openedAt: "",
                resolvedAt: moment.at,
              },
            ]
          : [],
      ),
    ],
  });
}

/** After the browser's `Last-Event-ID`, so IDs keep increasing. */
function firstId(lastEventId: string | undefined): number {
  if (lastEventId === undefined || !/^\d{1,15}$/.test(lastEventId)) {
    return 1;
  }
  return Number(lastEventId) + 1;
}
