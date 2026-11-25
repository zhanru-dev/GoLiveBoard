import { createServer, type Socket } from "node:net";

export interface SilentServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** How many connections it has accepted. */
  connections(): number;
  close(): Promise<void>;
}

/**
 * A server that accepts connections and never answers: what a frozen or
 * overloaded dependency looks like from the outside. A client that relies on
 * the connection failing will wait forever; only its own timeouts help.
 */
export async function startSilentServer(): Promise<SilentServer> {
  const sockets = new Set<Socket>();
  let accepted = 0;
  const server = createServer((socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The silent server has no port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    connections: () => accepted,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
