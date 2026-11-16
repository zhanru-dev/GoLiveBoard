import { EventEmitter } from "node:events";

import type { LiveOps } from "@opspilot/contracts";
import type { Response } from "express";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "../auth/actor.js";
import type { ActorLoader } from "../auth/actor-loader.js";
import type { LiveOpsService } from "./live-ops.service.js";
import { LiveOpsStreams, LiveOpsTiming } from "./live-ops-streams.js";

const ACTOR: Actor = {
  userId: "0193f2a4-0000-7000-8000-000000000001",
  sessionId: "0193f2a4-0000-7000-8000-000000000002",
  workspaceId: "0193f2a4-0000-7000-8000-000000000003",
  role: "OWNER",
  requestId: "req-1",
};

const SNAPSHOT: LiveOps = {
  event: {
    id: "0193f2a4-0000-7000-8000-000000000004",
    slug: "launch",
    title: "Launch",
    status: "LIVE",
    startsAt: "2026-12-01T17:00:00.000Z",
    endsAt: "2026-12-01T18:00:00.000Z",
    timeZone: "Europe/London",
  },
  stream: null,
  audience: { current: 0, peak: 0, series: [] },
  rates: { messagesPerMinute: 0, questionsPerMinute: 0 },
  incidents: [],
  timeline: [],
  at: "2026-12-01T17:00:00.000Z",
};

/** A response whose client stopped reading: this much is still unsent. */
function response(buffered: number) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    writableLength: buffered,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => emitter.emit("close")),
  });
}

function streams() {
  return new LiveOpsStreams(
    { snapshot: () => Promise.resolve(SNAPSHOT) } as unknown as LiveOpsService,
    {} as ActorLoader,
    new LiveOpsTiming(),
    { warn: vi.fn() } as unknown as PinoLogger,
  );
}

describe("LiveOpsStreams", () => {
  it("drops a browser more than 1 MiB behind, which reconnects with a snapshot", async () => {
    const live = streams();
    const slow = response(1024 * 1024 + 1);

    await live.start(
      ACTOR,
      SNAPSHOT.event.id,
      undefined,
      slow as unknown as Response,
    );

    expect(slow.end).toHaveBeenCalled();
    expect(live.size).toBe(0);
    expect(slow.write).not.toHaveBeenCalledWith(
      expect.stringContaining("event: snapshot"),
    );
  });

  it("keeps a browser that is reading", async () => {
    const live = streams();
    const reading = response(0);

    await live.start(
      ACTOR,
      SNAPSHOT.event.id,
      undefined,
      reading as unknown as Response,
    );

    expect(reading.end).not.toHaveBeenCalled();
    expect(live.size).toBe(1);
    expect(reading.write).toHaveBeenCalledWith(
      expect.stringContaining("event: snapshot"),
    );
    live.beforeApplicationShutdown();
    expect(live.size).toBe(0);
  });

  it("looks every second at most, as FR-RN-7's 2 seconds need", () => {
    expect(new LiveOpsTiming().lookEveryMs).toBeLessThanOrEqual(1_000);
  });
});
