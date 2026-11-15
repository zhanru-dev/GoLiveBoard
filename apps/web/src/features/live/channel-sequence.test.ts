import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelSequence, GAP_WAIT_MS } from "./channel-sequence";

const event = (sequence: number) => ({
  sequence,
  label: `e${String(sequence)}`,
});

function setUp() {
  const applied: number[] = [];
  const onGap = vi.fn();
  const channel = new ChannelSequence(
    (applying: { sequence: number }) => applied.push(applying.sequence),
    onGap,
  );
  return { channel, applied, onGap };
}

describe("ChannelSequence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the replay, then live events held while the join was in flight, once each", () => {
    const { channel, applied } = setUp();
    channel.reset(3);
    channel.joinStarted();
    channel.receive(event(6));
    channel.receive(event(5));

    channel.joined(6, [event(4), event(5), event(6)]);
    channel.receive(event(6));
    channel.receive(event(7));

    expect(applied).toEqual([4, 5, 6, 7]);
    expect(channel.latest).toBe(7);
  });

  it("does not mistake events that arrive during a slow join for a gap", () => {
    const { channel, applied, onGap } = setUp();
    channel.reset(3);
    channel.joinStarted();
    channel.receive(event(6));

    vi.advanceTimersByTime(GAP_WAIT_MS * 2);
    channel.joined(5, [event(4), event(5)]);

    expect(onGap).not.toHaveBeenCalled();
    expect(applied).toEqual([4, 5, 6]);
  });

  it("ignores what the snapshot already had", () => {
    const { channel, applied } = setUp();
    channel.reset(10);
    channel.joined(10, []);

    channel.receive(event(9));
    channel.receive(event(10));

    expect(applied).toEqual([]);
  });

  it("puts events that arrive out of order back in order", () => {
    const { channel, applied, onGap } = setUp();
    channel.joined(0, []);

    channel.receive(event(3));
    channel.receive(event(2));
    channel.receive(event(1));
    vi.advanceTimersByTime(GAP_WAIT_MS * 2);

    expect(applied).toEqual([1, 2, 3]);
    expect(onGap).not.toHaveBeenCalled();
  });

  it("asks to join again when a missing event does not arrive", () => {
    const { channel, applied, onGap } = setUp();
    channel.joined(0, []);
    channel.receive(event(1));
    channel.receive(event(3));

    vi.advanceTimersByTime(GAP_WAIT_MS - 1);
    expect(onGap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onGap).toHaveBeenCalledOnce();
    expect(applied).toEqual([1]);
    expect(channel.latest).toBe(1);
    // The rejoin's replay then fills the hole.
    channel.joinStarted();
    channel.joined(3, [event(2), event(3)]);
    expect(applied).toEqual([1, 2, 3]);
  });

  it("takes a replay's latest sequence even when it skipped entries", () => {
    const { channel, applied } = setUp();
    channel.joined(5, [event(2)]);
    channel.receive(event(6));

    expect(applied).toEqual([2, 6]);
  });

  it("stops waiting once it is disposed", () => {
    const { channel, onGap } = setUp();
    channel.joined(0, []);
    channel.receive(event(2));

    channel.dispose();
    vi.advanceTimersByTime(GAP_WAIT_MS * 2);

    expect(onGap).not.toHaveBeenCalled();
  });
});
