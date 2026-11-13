import { createServer, type Server, type ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain/domain-error.js";
import { loadTestConfig } from "../testing/config.js";
import {
  type SilentServer,
  startSilentServer,
} from "../testing/silent-server.js";
import { ObjectStorage, type StorageTimeouts } from "./object-storage.js";

/** Far longer than any test waits, so only the limit under test can end it. */
const NEVER_MS = 120_000;

describe("ObjectStorage when storage accepts a connection and never answers", () => {
  let silent: SilentServer;
  const clients: ObjectStorage[] = [];

  beforeAll(async () => {
    silent = await startSilentServer();
  });

  afterAll(async () => {
    for (const client of clients) {
      client.destroy();
    }
    await silent.close();
  });

  function storageWith(timeouts: Partial<StorageTimeouts>): ObjectStorage {
    const storage = new ObjectStorage(
      loadTestConfig({
        S3_ENDPOINT: silent.url,
        S3_ACCESS_KEY_ID: "test",
        S3_SECRET_ACCESS_KEY: "test",
        S3_FORCE_PATH_STYLE: "true",
      }),
      {
        connectMs: NEVER_MS,
        requestMs: NEVER_MS,
        operationMs: NEVER_MS,
        ...timeouts,
      },
    );
    clients.push(storage);
    return storage;
  }

  /** Runs `call` and returns how long it took to fail, and with what. */
  async function failure(call: () => Promise<unknown>) {
    const started = performance.now();
    const error: unknown = await call().then(
      () => undefined,
      (caught: unknown) => caught,
    );
    return { error, elapsedMs: performance.now() - started };
  }

  it(
    "fails each attempt at the request timeout, not just warns",
    { timeout: 10_000 },
    async () => {
      const storage = storageWith({ requestMs: 200 });

      const { error, elapsedMs } = await failure(() => storage.stat("any"));

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("SERVICE_UNAVAILABLE");
      // Three attempts of 200 ms, with short backoff in between.
      expect(elapsedMs).toBeLessThan(3_000);
    },
  );

  it(
    "ends the whole call, retries included, at the operation timeout",
    { timeout: 10_000 },
    async () => {
      const storage = storageWith({ operationMs: 300 });

      const { error, elapsedMs } = await failure(() =>
        storage.copy("uploads/any", "any"),
      );

      expect((error as DomainError).code).toBe("SERVICE_UNAVAILABLE");
      expect(elapsedMs).toBeLessThan(1_500);
    },
  );

  it(
    "stops when the caller's budget runs out first",
    { timeout: 10_000 },
    async () => {
      const storage = storageWith({});

      const { error, elapsedMs } = await failure(() =>
        storage.readStart("any", 12, AbortSignal.timeout(300)),
      );

      expect((error as DomainError).code).toBe("SERVICE_UNAVAILABLE");
      expect(elapsedMs).toBeLessThan(1_500);
    },
  );
});

describe("ObjectStorage when storage sends headers and then stalls", () => {
  let server: Server;
  const stalled = new Set<ServerResponse>();
  let storage: ObjectStorage;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      // Promise twelve bytes and send none of them.
      response.writeHead(206, {
        "Content-Type": "image/png",
        "Content-Length": "12",
        "Content-Range": "bytes 0-11/2048",
      });
      response.flushHeaders();
      stalled.add(response);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("No port");
    }
    storage = new ObjectStorage(
      loadTestConfig({
        S3_ENDPOINT: `http://127.0.0.1:${String(address.port)}`,
        S3_ACCESS_KEY_ID: "test",
        S3_SECRET_ACCESS_KEY: "test",
        S3_FORCE_PATH_STYLE: "true",
      }),
      { connectMs: NEVER_MS, requestMs: NEVER_MS, operationMs: 300 },
    );
  });

  afterAll(async () => {
    storage.destroy();
    for (const response of stalled) {
      response.destroy();
    }
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it(
    "stops waiting for a body that never arrives",
    { timeout: 10_000 },
    async () => {
      const started = performance.now();
      const error: unknown = await storage.readStart("any", 12).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect((error as DomainError).code).toBe("SERVICE_UNAVAILABLE");
      expect(performance.now() - started).toBeLessThan(1_500);
    },
  );
});
