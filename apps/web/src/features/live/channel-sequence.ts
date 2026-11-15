/** How long a missing sequence may stay missing before the client rejoins. */
export const GAP_WAIT_MS = 2_000;

interface Sequenced {
  readonly sequence: number;
}

/**
 * Applies one channel's events in order, each exactly once (FR-RN-2), from
 * three sources: the HTTP snapshot, the replay of a join and live events.
 *
 * - While a join is in flight, live events are held: they may be newer
 *   than the replay that is coming.
 * - An event at or below the highest applied sequence is a duplicate.
 * - An event ahead of the next one waits for the ones in between: events
 *   committed close together can arrive out of order. If the gap is still
 *   there after GAP_WAIT_MS, `onGap` asks the owner to join again after the
 *   last sequence applied, which replays what is missing.
 */
export class ChannelSequence<E extends Sequenced> {
  private highest = 0;
  private joining = true;
  private held: E[] = [];
  private readonly ahead = new Map<number, E>();
  private gapTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly apply: (event: E) => void,
    private readonly onGap: () => void,
    private readonly gapWaitMs = GAP_WAIT_MS,
  ) {}

  /** The last sequence applied: what a join asks to continue after. */
  get latest(): number {
    return this.highest;
  }

  /** Starts from a snapshot loaded over HTTP, which ends at `latest`. */
  reset(latest: number): void {
    this.highest = latest;
    this.ahead.clear();
    this.held = [];
    this.clearGap();
  }

  /** A join is in flight: hold live events until it is answered. */
  joinStarted(): void {
    this.joining = true;
  }

  /**
   * The join's answer: apply the replay, then everything held meanwhile.
   * Entries the server left out of the replay (none should be) are covered
   * by `latestSequence`.
   */
  joined(latestSequence: number, replay: readonly E[]): void {
    this.joining = false;
    // The server's own account of what happened since: applied in order,
    // even across a sequence it left out.
    for (const event of [...replay].sort((a, b) => a.sequence - b.sequence)) {
      if (event.sequence > this.highest) {
        this.apply(event);
        this.highest = event.sequence;
      }
    }
    if (latestSequence > this.highest) {
      this.highest = latestSequence;
      this.drain();
    }
    const held = this.held;
    this.held = [];
    for (const event of held) {
      this.receive(event);
    }
  }

  /** A live event. */
  receive(event: E): void {
    if (this.joining) {
      this.held.push(event);
      return;
    }
    this.accept(event);
  }

  /** Stops the gap timer; for when the channel is left. */
  dispose(): void {
    this.clearGap();
  }

  private accept(event: E): void {
    if (event.sequence <= this.highest) {
      return;
    }
    if (event.sequence > this.highest + 1) {
      this.ahead.set(event.sequence, event);
      this.watchGap();
      return;
    }
    this.apply(event);
    this.highest = event.sequence;
    this.drain();
  }

  private drain(): void {
    for (const key of [...this.ahead.keys()].sort((a, b) => a - b)) {
      const event = this.ahead.get(key);
      this.ahead.delete(key);
      if (event !== undefined && key > this.highest) {
        if (key === this.highest + 1) {
          this.apply(event);
          this.highest = key;
        } else {
          this.ahead.set(key, event);
          break;
        }
      }
    }
    if (this.ahead.size === 0) {
      this.clearGap();
    }
  }

  private watchGap(): void {
    if (this.gapTimer !== undefined) {
      return;
    }
    this.gapTimer = setTimeout(() => {
      this.gapTimer = undefined;
      if (this.ahead.size > 0) {
        this.ahead.clear();
        this.onGap();
      }
    }, this.gapWaitMs);
  }

  private clearGap(): void {
    clearTimeout(this.gapTimer);
    this.gapTimer = undefined;
  }
}
