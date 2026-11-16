/**
 * A stand-in for the browser's EventSource (jsdom has none): a test opens
 * nothing, and plays the server's part through `emit`, `fail` and `refuse`.
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static readonly opened: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    super();
    FakeEventSource.opened.push(this);
  }

  /** The latest stream opened. */
  static last(): FakeEventSource {
    const source = FakeEventSource.opened.at(-1);
    if (source === undefined) {
      throw new Error("No EventSource was opened");
    }
    return source;
  }

  static install(): void {
    FakeEventSource.opened.length = 0;
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: FakeEventSource,
    });
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emit(event: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) }));
  }

  /** The connection dropped; the browser will try again by itself. */
  fail(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event("error"));
  }

  /** The server answered other than 200: the browser gives up. */
  refuse(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.dispatchEvent(new Event("error"));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}
