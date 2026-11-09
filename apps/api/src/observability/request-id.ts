import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * A caller's request ID is reused only if it is short and plain. Anything else
 * is replaced, so a client cannot inject newlines or huge values into our logs
 * and response headers.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Returns the request ID to use for one request: the incoming `X-Request-Id`
 * (set by the proxy, so one ID follows the request across services) when it
 * is safe, otherwise a new random UUID.
 */
export function resolveRequestId(
  incoming: string | string[] | undefined,
  generate: () => string = randomUUID,
): string {
  if (typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return generate();
}
