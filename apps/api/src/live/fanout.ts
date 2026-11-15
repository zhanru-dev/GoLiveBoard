import { Injectable } from "@nestjs/common";
import type { ChatEvent, RealtimeChannel } from "@opspilot/contracts";

import { channelRoom } from "./rooms.js";

/** What services send to an event's channel. */
interface ChannelEvents {
  "chat.event": ChatEvent;
}

/** The part of the Socket.IO server that sends to rooms. */
export interface RoomEmitter {
  to(room: string): { emit(name: string, payload: unknown): boolean };
}

/**
 * Sends to everyone on an event's channel, on every API instance (through
 * the Valkey adapter). The gateway hands it the server when it starts;
 * services that change chat or Q&A send through it after their commit.
 */
@Injectable()
export class Fanout {
  private server?: RoomEmitter;

  attach(server: RoomEmitter): void {
    this.server = server;
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
}
