import { createServer, type IncomingMessage } from "node:http";
import { gunzipSync } from "node:zlib";

/** One error event as Sentry receives it, plus the raw envelope it came in. */
export interface ReceivedEvent {
  readonly event: Record<string, unknown>;
  readonly envelope: string;
}

export interface FakeSentry {
  /** A DSN for project 1 on this server. */
  readonly dsn: string;
  /** The error events received so far. */
  events(): readonly ReceivedEvent[];
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  return (
    request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body
  ).toString("utf8");
}

/**
 * Stands in for Sentry's ingest endpoint, so tests can see exactly what the
 * SDK sends. An envelope is newline-separated JSON: a header, then pairs of
 * item header and item payload.
 */
export async function startFakeSentry(): Promise<FakeSentry> {
  const received: ReceivedEvent[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((envelope) => {
      const [, ...items] = envelope.split("\n").filter((line) => line !== "");
      for (let index = 0; index + 1 < items.length; index += 2) {
        const header = JSON.parse(items[index] ?? "{}") as { type?: string };
        if (header.type === "event") {
          received.push({
            event: JSON.parse(items[index + 1] ?? "{}") as Record<
              string,
              unknown
            >,
            envelope,
          });
        }
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fake Sentry server has no port");
  }
  return {
    dsn: `http://public@127.0.0.1:${String(address.port)}/1`,
    events: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
