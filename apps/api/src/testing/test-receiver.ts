import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { isPublicAddress } from "../net/address-policy.js";
import type { SafeHttpOptions } from "../net/safe-http.js";
import { verifySignature } from "../webhooks/signing.js";

const run = promisify(execFile);

/** How the receiver answers the next request. */
export type ReceiverAnswer = number | "HANG";

export interface ReceivedRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/**
 * A customer's webhook receiver on 127.0.0.1, as "hooks.test", over HTTPS
 * with a certificate made by openssl at start-up. It records every request
 * and answers as the test says (200 unless told otherwise).
 *
 * `accepted` does what docs/04 section 6.1 asks of a real receiver: keep a
 * request only if its signature verifies with the secret, and keep each
 * webhook `id` once.
 */
export class TestReceiver {
  readonly requests: ReceivedRequest[] = [];
  /** Answers for the next requests to each path, in order; then `fallback`. */
  readonly answers = new Map<string, ReceiverAnswer[]>();
  fallback: ReceiverAnswer = 200;
  /** Hosts the test resolver knows; change them to move a host. */
  readonly hosts = new Map<string, string>([
    ["hooks.test", "127.0.0.1"],
    ["internal.test", "10.0.0.7"],
  ]);

  private constructor(
    private readonly server: Server,
    readonly ca: string,
    private readonly directory: string,
  ) {}

  static async start(): Promise<TestReceiver> {
    const directory = await mkdtemp(join(tmpdir(), "opspilot-receiver-"));
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
      "/CN=hooks.test",
      "-addext",
      "subjectAltName=DNS:hooks.test",
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
    const receiver = new TestReceiver(server, pem.cert, directory);
    server.on("request", (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receiver.requests.push({
          path: request.url ?? "/",
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        const answer =
          receiver.answers.get(request.url ?? "/")?.shift() ??
          receiver.fallback;
        if (answer === "HANG") {
          return;
        }
        response
          .writeHead(
            answer,
            answer >= 300 && answer < 400
              ? { location: "https://hooks.test/elsewhere" }
              : {},
          )
          .end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return receiver;
  }

  /** Answers the next requests to `path` so, in order. */
  answer(path: string, ...answers: ReceiverAnswer[]): void {
    this.answers.set(path, [...(this.answers.get(path) ?? []), ...answers]);
  }

  url(path = "/in"): string {
    const { port } = this.server.address() as AddressInfo;
    return `https://hooks.test:${String(port)}${path}`;
  }

  /**
   * Client options for the API and the worker: this resolver, this
   * certificate, and the production address rule except loopback, where
   * this server listens.
   */
  clientOptions(timeoutMs?: number): SafeHttpOptions {
    return {
      resolve: (hostname) => {
        const address = this.hosts.get(hostname);
        return address === undefined
          ? Promise.reject(new Error(`ENOTFOUND ${hostname}`))
          : Promise.resolve([{ address, family: 4 as const }]);
      },
      isAllowedAddress: (address) =>
        address === "127.0.0.1" || isPublicAddress(address),
      ca: this.ca,
      ...(timeoutMs !== undefined && { timeoutMs }),
    };
  }

  /**
   * The webhooks a receiver keeps: signed with `secret` within the
   * tolerance, each `id` once, in arrival order.
   */
  accepted(secret: string, nowSeconds: number): unknown[] {
    const seen = new Set<string>();
    return this.requests.flatMap((request) => {
      const signature = request.headers["opspilot-signature"];
      if (
        typeof signature !== "string" ||
        !verifySignature(signature, secret, request.body, nowSeconds)
      ) {
        return [];
      }
      const webhook = JSON.parse(request.body) as { id: string };
      if (seen.has(webhook.id)) {
        return [];
      }
      seen.add(webhook.id);
      return [webhook];
    });
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
}
