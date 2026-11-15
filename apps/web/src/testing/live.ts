import type { RealtimeChannel } from "@opspilot/contracts";
import { act } from "@testing-library/react";
import { vi } from "vitest";

import type * as RealtimeConnectionModule from "@/features/live/realtime-connection";
import type {
  ChannelOptions,
  ConnectionOptions,
} from "@/features/live/realtime-connection";

/**
 * Stands in for RealtimeConnection in component tests (jsdom has no
 * server to connect to): it loads each channel's snapshot, and the test
 * delivers events and answers requests.
 *
 * Use with
 * `vi.mock("@/features/live/realtime-connection", () => fakeRealtimeModule())`.
 */
export class FakeRealtimeConnection {
  static last: FakeRealtimeConnection | undefined;
  readonly followed = new Map<
    RealtimeChannel,
    ChannelOptions<RealtimeChannel>
  >();
  readonly request = vi.fn<
    (name: string, payload: unknown) => Promise<unknown>
  >(() => Promise.resolve({ ok: true }));
  connected = true;

  constructor(readonly options: ConnectionOptions) {
    FakeRealtimeConnection.last = this;
  }

  connect(): void {
    this.options.onState("connected");
  }

  async follow(options: ChannelOptions<RealtimeChannel>): Promise<void> {
    this.followed.set(options.channel, options);
    await options.loadSnapshot();
  }

  onConnect(): () => void {
    return () => undefined;
  }

  close(): void {
    this.connected = false;
  }

  /** The server sends a channel event. */
  deliver(channel: RealtimeChannel, event: unknown): void {
    act(() => {
      (
        this.followed.get(channel)?.apply as
          ((event: unknown) => void) | undefined
      )?.(event);
    });
  }
}

export async function fakeRealtimeModule() {
  const actual = await vi.importActual<typeof RealtimeConnectionModule>(
    "@/features/live/realtime-connection",
  );
  return { ...actual, RealtimeConnection: FakeRealtimeConnection };
}
