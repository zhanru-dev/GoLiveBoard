import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { isPublicAddress } from "../net/address-policy.js";
import type { ResolvedAddress, SafeHttpOptions } from "../net/safe-http.js";

const run = promisify(execFile);

/** How the test stream answers its manifest URL. */
export type StreamBehaviour = "OK" | "NOT_FOUND" | "NOT_HLS" | "HANG" | "HUGE";

/** Names the test resolver knows; everything else fails to resolve. */
export const TEST_HOSTS: Readonly<Record<string, readonly string[]>> = {
  "stream.test": ["127.0.0.1"],
  "private.test": ["10.0.0.7"],
  "metadata.test": ["169.254.169.254"],
  "mixed.test": ["93.184.215.14", "10.0.0.7"],
  "public.test": ["93.184.215.14"],
};

export const MANIFEST_PATH = "/live/index.m3u8";
const MANIFEST =
  "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n";

/**
 * A real HTTPS server on 127.0.0.1 standing in for a streaming provider, with
 * a self-signed certificate for "stream.test" made by openssl at start-up. A
 * test switches its behaviour to simulate an outage and a recovery.
 */
export class TestStream {
  behaviour: StreamBehaviour = "OK";
  requests = 0;

  private constructor(
    private readonly server: Server,
    readonly ca: string,
    private readonly directory: string,
  ) {}

  static async start(): Promise<TestStream> {
    const directory = await mkdtemp(join(tmpdir(), "opspilot-stream-"));
    const key = join(directory, "key.pem");
    const cert = join(directory, "cert.pem");
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=stream.test",
      "-addext",
      "subjectAltName=DNS:stream.test",
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    const pem = {
      key: await readFile(key, "utf8"),
      cert: await readFile(cert, "utf8"),
    };
    const server = createServer(pem);
    const stream = new TestStream(server, pem.cert, directory);
    server.on("request", (request, response) => {
      stream.handle(request.url ?? "/", response);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return stream;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  /** A URL on this server, under a host name the test resolver maps. */
  url(path = MANIFEST_PATH, host = "stream.test"): string {
    return `https://${host}:${String(this.port)}${path}`;
  }

  /**
   * Client options for tests: the test resolver, this server's certificate,
   * and the production address rule except that loopback, where this server
   * listens, is allowed. Pass `strict` to keep the production rule exactly.
   */
  clientOptions(overrides: Partial<SafeHttpOptions> = {}): SafeHttpOptions {
    return {
      resolve: (hostname: string): Promise<ResolvedAddress[]> => {
        const addresses = TEST_HOSTS[hostname];
        if (addresses === undefined) {
          return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
        }
        return Promise.resolve(
          addresses.map((address) => ({
            address,
            family: address.includes(":") ? 6 : 4,
          })),
        );
      },
      isAllowedAddress: (address) =>
        address === "127.0.0.1" || isPublicAddress(address),
      ca: this.ca,
      timeoutMs: 500,
      ...overrides,
    };
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
    await rm(this.directory, { recursive: true, force: true });
  }

  private handle(path: string, response: ServerResponse): void {
    this.requests += 1;
    const redirect = /^\/redirect\?to=(.+)$/.exec(path);
    if (redirect?.[1] !== undefined) {
      response.writeHead(302, { location: decodeURIComponent(redirect[1]) });
      response.end();
      return;
    }
    if (path !== MANIFEST_PATH) {
      response.writeHead(404).end();
      return;
    }
    switch (this.behaviour) {
      case "OK":
        response.writeHead(200, {
          "content-type": "application/vnd.apple.mpegurl",
        });
        response.end(MANIFEST);
        return;
      case "NOT_FOUND":
        response.writeHead(404).end("Not found");
        return;
      case "NOT_HLS":
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html>Sign in</html>");
        return;
      case "HUGE":
        response.writeHead(200);
        response.end(Buffer.alloc(2 * 1024 * 1024, "#"));
        return;
      case "HANG":
        return;
      default:
        this.behaviour satisfies never;
    }
  }
}
