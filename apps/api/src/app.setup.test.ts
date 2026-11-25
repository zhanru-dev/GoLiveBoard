import { EventEmitter } from "node:events";

import { Logger } from "nestjs-pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listenWhenReady } from "./app.setup.js";
import { VALKEY_CLIENT } from "./valkey/valkey.js";

/** An app whose Valkey connects when the test says so. */
function fakeApp() {
  const valkey = Object.assign(new EventEmitter(), { status: "connecting" });
  const logger = { warn: vi.fn() };
  const listen = vi.fn(() => Promise.resolve());
  const app = {
    get: (token: unknown) =>
      new Map<unknown, unknown>([
        [VALKEY_CLIENT, valkey],
        [Logger, logger],
      ]).get(token),
    listen,
  };
  const connect = () => {
    valkey.status = "ready";
    valkey.emit("ready");
  };
  return { app, listen, logger, connect };
}

describe("listenWhenReady", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("listens only once Valkey is connected", async () => {
    const { app, listen, logger, connect } = fakeApp();

    const started = listenWhenReady(app as never, 3000, "0.0.0.0", 30_000);
    await Promise.resolve();
    expect(listen).not.toHaveBeenCalled();

    connect();
    await started;

    expect(listen).toHaveBeenCalledWith(3000, "0.0.0.0");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("listens anyway, with a warning, when Valkey does not come", async () => {
    vi.useFakeTimers();
    const { app, listen, logger } = fakeApp();

    const started = listenWhenReady(app as never, 3000, "0.0.0.0", 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await started;

    expect(listen).toHaveBeenCalledWith(3000, "0.0.0.0");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Valkey not connected"),
    );
  });
});
