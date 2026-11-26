import type { ChatEvent } from "@goliveboard/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_BATCH_MS, Fanout, type RoomEmitter } from "./fanout.js";
import { channelRoom } from "./rooms.js";

/** Records what is emitted, to which rooms. */
function recorder() {
  const sent: { rooms: string[]; name: string; payload: unknown }[] = [];
  const emitter: RoomEmitter = {
    to(room) {
      const rooms = Array.isArray(room) ? room : [room];
      const broadcast = {
        except: () => broadcast,
        emit(name: string, payload: unknown) {
          sent.push({ rooms, name, payload });
          return true;
        },
      };
      return broadcast;
    },
  };
  return { sent, emitter };
}

const chat = (sequence: number): ChatEvent => ({
  sequence,
  kind: "MESSAGE_CREATED",
  message: {
    id: `0195f0a0-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    author: { kind: "ATTENDEE", name: "Ada" },
    body: `Message ${String(sequence)}`,
    deleted: false,
    createdAt: "2026-11-18T10:00:00.000Z",
  },
});

describe("Fanout's chat frames (NFR-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends an event's chat events within the window as one frame, in order", () => {
    const { sent, emitter } = recorder();
    const fanout = new Fanout();
    fanout.attach(emitter);

    fanout.toChat("event-1", chat(1));
    vi.advanceTimersByTime(CHAT_BATCH_MS / 2);
    fanout.toChat("event-1", chat(2));
    fanout.toChat("event-1", chat(3));
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(CHAT_BATCH_MS / 2);

    expect(sent).toEqual([
      {
        rooms: [channelRoom("event-1", "CHAT")],
        name: "chat.events",
        payload: [chat(1), chat(2), chat(3)],
      },
    ]);
  });

  it("keeps events apart, and starts a new frame after each window", () => {
    const { sent, emitter } = recorder();
    const fanout = new Fanout();
    fanout.attach(emitter);

    fanout.toChat("event-1", chat(1));
    fanout.toChat("event-2", chat(7));
    vi.advanceTimersByTime(CHAT_BATCH_MS);
    fanout.toChat("event-1", chat(2));
    vi.advanceTimersByTime(CHAT_BATCH_MS);

    expect(sent.map(({ rooms, payload }) => [rooms[0], payload])).toEqual([
      [channelRoom("event-1", "CHAT"), [chat(1)]],
      [channelRoom("event-2", "CHAT"), [chat(7)]],
      [channelRoom("event-1", "CHAT"), [chat(2)]],
    ]);
  });

  it("sends what is gathered at once when the instance stops", () => {
    const { sent, emitter } = recorder();
    const fanout = new Fanout();
    fanout.attach(emitter);
    fanout.toChat("event-1", chat(1));

    fanout.onApplicationShutdown();

    expect(sent.map(({ payload }) => payload)).toEqual([[chat(1)]]);
    vi.advanceTimersByTime(CHAT_BATCH_MS);
    expect(sent).toHaveLength(1);
  });
});
