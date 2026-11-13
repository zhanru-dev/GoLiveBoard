import { Redis } from "ioredis";

import type { AppConfig } from "../config/app-config.js";

/** Injection token for the shared Valkey client. */
export const VALKEY_CLIENT = Symbol("VALKEY_CLIENT");

/**
 * A command that has not answered by then fails, so a stalled Valkey cannot
 * hold a request; callers decide what failure means (rate limits fail open).
 */
export const COMMAND_TIMEOUT_MS = 500;
/**
 * A command that times out is only abandoned by the caller: it stays queued
 * on the connection, and a frozen server would let the queue grow without
 * bound, then run every stale command when it wakes up (the milestone 2
 * review). If the socket receives nothing for this long while commands are
 * waiting, it is destroyed instead: everything queued fails at once and the
 * client reconnects, so at most this much traffic can pile up.
 */
export const SOCKET_TIMEOUT_MS = 1_000;
/** Longest wait for a clean QUIT before the socket is simply closed. */
const QUIT_TIMEOUT_MS = 1_000;

/**
 * The client used on the request path. It connects in the background as soon
 * as it is created and reconnects on its own; while it is disconnected,
 * commands fail at once instead of queueing behind the outage.
 */
export function createValkeyClient(config: AppConfig): Redis {
  return new Redis(config.valkey.url, {
    connectionName: "opspilot-api",
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

/**
 * Closes the client within a deadline. QUIT lets Valkey finish cleanly, but a
 * frozen server would never answer it (the milestone 1 review), so after the
 * deadline the socket is closed regardless.
 */
export async function closeValkeyClient(client: Redis): Promise<void> {
  if (client.status === "ready") {
    const deadline = new Promise<void>((resolve) =>
      setTimeout(resolve, QUIT_TIMEOUT_MS).unref(),
    );
    await Promise.race([
      client.quit().then(
        () => undefined,
        () => undefined,
      ),
      deadline,
    ]);
  }
  client.disconnect();
}
