/**
 * Makes the named methods of a Valkey client resolve instead of reject.
 *
 * The Socket.IO adapter calls `subscribe`, `psubscribe` and `publish`
 * without waiting for them. A command that fails (the connection closed, or
 * Valkey is down and commands fail at once) would otherwise be an unhandled
 * rejection, and Node ends the process on one.
 */
export function catchRejections<T extends object>(
  client: T,
  methods: readonly (keyof T & string)[],
  onError: (method: string, error: unknown) => void,
): T {
  for (const method of methods) {
    const original: unknown = client[method];
    if (typeof original !== "function") {
      throw new TypeError(`${method} is not a method`);
    }
    const call = original.bind(client) as (...args: unknown[]) => unknown;
    Object.defineProperty(client, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const result = call(...args);
        return result instanceof Promise
          ? result.catch((error: unknown) => {
              onError(method, error);
              return undefined;
            })
          : result;
      },
    });
  }
  return client;
}
