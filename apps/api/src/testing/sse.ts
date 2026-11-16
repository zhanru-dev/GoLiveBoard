import { type ClientRequest, type IncomingMessage, request } from "node:http";

export interface SseMessage {
  readonly id: string | undefined;
  readonly event: string;
  readonly data: unknown;
}

/**
 * A server-sent events reader for tests: what a browser's EventSource
 * receives, kept in order, with the comment lines counted.
 */
export class SseClient {
  readonly messages: SseMessage[] = [];
  comments = 0;
  retry: number | undefined;
  readonly ended: Promise<void>;
  private buffer = "";

  private constructor(
    readonly status: number,
    readonly headers: IncomingMessage["headers"],
    readonly body: string,
    private readonly request: ClientRequest,
    response: IncomingMessage,
  ) {
    this.ended = new Promise((resolve) => {
      response.on("close", resolve);
      response.on("end", resolve);
    });
    if (status === 200) {
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        this.read(chunk);
      });
    }
  }

  static open(
    url: string,
    headers: Record<string, string>,
  ): Promise<SseClient> {
    return new Promise((resolve, reject) => {
      const outgoing = request(url, {
        headers: { accept: "text/event-stream", ...headers },
      });
      outgoing.on("error", reject);
      outgoing.on("response", (response) => {
        if (response.statusCode === 200) {
          resolve(new SseClient(200, response.headers, "", outgoing, response));
          return;
        }
        // Not a stream: read the whole answer (a problem document).
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => {
          resolve(
            new SseClient(
              response.statusCode ?? 0,
              response.headers,
              body,
              outgoing,
              response,
            ),
          );
        });
      });
      outgoing.end();
    });
  }

  /** The named messages so far. */
  named(event: string): SseMessage[] {
    return this.messages.filter((message) => message.event === event);
  }

  /** Resolves with the first `event` message after the first `after`. */
  async next(event: string, after = 0, timeoutMs = 5_000): Promise<SseMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages
        .slice(after)
        .find((message) => message.event === event);
      if (found !== undefined) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `No "${event}" within ${String(timeoutMs)} ms; got ${JSON.stringify(this.messages.map((message) => message.event))}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): void {
    this.request.destroy();
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      this.parse(block);
      end = this.buffer.indexOf("\n\n");
    }
  }

  private parse(block: string): void {
    let id: string | undefined;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        this.comments += 1;
      } else if (line.startsWith("retry: ")) {
        this.retry = Number(line.slice(7));
      } else if (line.startsWith("id: ")) {
        id = line.slice(4);
      } else if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data.push(line.slice(6));
      }
    }
    if (data.length > 0) {
      this.messages.push({ id, event, data: JSON.parse(data.join("\n")) });
    }
  }
}
