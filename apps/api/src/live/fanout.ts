import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type {
  ChatEvent,
  QuestionsEvent,
  RealtimeChannel,
} from "@opspilot/contracts";

import { channelRoom } from "./rooms.js";

/** What services send to an event's channel, one event at a time. */
interface ChannelEvents {
  "questions.event": QuestionsEvent;
}

/**
 * How long chat events are gathered before they go out together. Every
 * connection costs one write per frame, and a busy event's chat is the most
 * frequent thing sent: at 20 messages a second to 500 attendees, a frame per
 * message is 10,000 writes a second on one thread (docs/load-tests). A short
 * window turns several messages into one frame, for at most this delay.
 */
export const CHAT_BATCH_MS = 100;

interface Broadcast {
  except(rooms: string[]): Broadcast;
  emit(name: string, payload: unknown): boolean;
}

/** The part of the Socket.IO server that sends to rooms. */
export interface RoomEmitter {
  to(room: string | string[]): Broadcast;
}

/**
 * Sends to everyone on an event's channel, on every API instance (through
 * the Valkey adapter). The gateway hands it the server when it starts;
 * services that change chat or Q&A send through it after their commit.
 */
@Injectable()
export class Fanout implements OnApplicationShutdown {
  private server?: RoomEmitter;
  /** Chat events waiting for their frame, by event ID, in order. */
  private readonly pendingChat = new Map<
    string,
    { readonly events: ChatEvent[]; readonly timer: NodeJS.Timeout }
  >();

  attach(server: RoomEmitter): void {
    this.server = server;
  }

  /**
   * Sends a chat event to everyone on the event's chat, with any others of
   * the same event within CHAT_BATCH_MS, in the order they were given
   * (`chat.events`).
   */
  toChat(eventId: string, event: ChatEvent): void {
    const pending = this.pendingChat.get(eventId);
    if (pending !== undefined) {
      pending.events.push(event);
      return;
    }
    const timer = setTimeout(() => {
      this.flushChat(eventId);
    }, CHAT_BATCH_MS);
    timer.unref();
    this.pendingChat.set(eventId, { events: [event], timer });
  }

  /** What is still gathered goes out as the instance stops. */
  onApplicationShutdown(): void {
    for (const eventId of [...this.pendingChat.keys()]) {
      this.flushChat(eventId);
    }
  }

  private flushChat(eventId: string): void {
    const pending = this.pendingChat.get(eventId);
    if (pending === undefined) {
      return;
    }
    this.pendingChat.delete(eventId);
    clearTimeout(pending.timer);
    this.server
      ?.to(channelRoom(eventId, "CHAT"))
      .emit("chat.events", pending.events);
  }

  toChannel<K extends keyof ChannelEvents>(
    eventId: string,
    channel: RealtimeChannel,
    name: K,
    payload: ChannelEvents[K],
  ): void {
    // Without a server (the worker) nobody is connected here to tell.
    this.server?.to(channelRoom(eventId, channel)).emit(name, payload);
  }

  /** Sends to some rooms, leaving out connections also in `except`. */
  toRooms<K extends keyof ChannelEvents>(
    rooms: string[],
    except: string[],
    name: K,
    payload: ChannelEvents[K],
  ): void {
    this.server?.to(rooms).except(except).emit(name, payload);
  }
}
