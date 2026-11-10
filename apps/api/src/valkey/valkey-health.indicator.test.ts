import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config/app-config.js";
import { runCheck } from "../health/health.service.js";
import { ValkeyHealthIndicator } from "./valkey-health.indicator.js";

/** A server that accepts connections and never answers: a stalled Valkey. */
async function startSilentServer() {
  const sockets = new Set<Socket>();
  const closed: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    // Read and discard what the client sends; a socket nobody reads from
    // never reports that the other side has closed it.
    socket.resume();
    socket.on("close", () => closed.push(socket));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return { server, port: address.port, sockets, closed };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function indicatorFor(port: number): ValkeyHealthIndicator {
  return new ValkeyHealthIndicator(
    loadConfig({
      DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
      VALKEY_URL: `redis://127.0.0.1:${port}`,
    }),
  );
}

describe("ValkeyHealthIndicator", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await closeServer(server);
    }
    server = undefined;
  });

  it("fails promptly when nothing listens", async () => {
    const silent = await startSilentServer();
    await closeServer(silent.server);

    const outcome = await runCheck(indicatorFor(silent.port), 1_000);

    expect(outcome.ok).toBe(false);
  });

  it("closes its connection when a check against a stalled server times out", async () => {
    const silent = await startSilentServer();
    server = silent.server;

    const outcome = await runCheck(indicatorFor(silent.port), 100);

    expect(outcome.ok).toBe(false);
    expect(silent.sockets.size).toBe(1);
    // Nothing is left waiting on the server once the check has given up.
    await vi.waitFor(() => {
      expect(silent.closed).toHaveLength(1);
    });
  });
});
