import { Redis } from "ioredis";

import type { AppConfig } from "../config/app-config.js";

/** Injection token for the shared Valkey client. */
export const VALKEY_CLIENT = Symbol("VALKEY_CLIENT");

/**
 * A command that has not answered by then fails, so a stalled Valkey cannot
 * hold a request; callers decide what failure means (rate limits fail open).
 */
const COMMAND_TIMEOUT_MS = 500;
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
