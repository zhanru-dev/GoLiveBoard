import { Redis } from "ioredis";

import type { AppConfig } from "../config/app-config.js";

/** Injection token for the shared Valkey client. */
export const VALKEY_CLIENT = Symbol("VALKEY_CLIENT");

/**
 * Creates the Valkey client (ioredis speaks the Redis protocol, which Valkey
 * implements). It connects lazily, on the first command, so the API starts
 * (and reports itself not ready) while Valkey is still starting.
 */
export function createValkeyClient(config: AppConfig): Redis {
  return new Redis(config.valkey.url, {
    lazyConnect: true,
    // Shown by CLIENT LIST, so an operator can tell who is connected.
    connectionName: "opspilot-api",
  });
}

/**
 * Closes the client without waiting on a dead server: QUIT is sent only to a
 * connected server, because ioredis would queue it until a reconnect.
 */
export async function closeValkeyClient(client: Redis): Promise<void> {
  if (client.status === "ready") {
    await client.quit();
    return;
  }
  client.disconnect();
}
