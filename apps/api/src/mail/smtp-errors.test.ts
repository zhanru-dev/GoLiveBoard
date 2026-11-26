import { once } from "node:events";
import { createServer, type Server } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MailDeliveryError, mailDeliveryError, SmtpMailer } from "./mailer.js";

const ADDRESS = "private-attendee@example.com";

/** Everything an error carries that could reach a log line or Sentry. */
function everythingIn(error: unknown): string {
  const record = error as Record<string, unknown>;
  return [
    String(error),
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    String(record.stack),
    JSON.stringify(record.cause ?? null),
  ].join("\n");
}

/**
 * An SMTP server that accepts the connection and the sender and refuses the
 * recipient, naming it, as real servers do.
 */
function refusingServer(): Server {
  return createServer((socket) => {
    socket.write("220 refusing.test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          socket.write("250 refusing.test\r\n");
        } else if (verb === "MAIL") {
          socket.write("250 2.1.0 Ok\r\n");
        } else if (verb === "RCPT") {
          socket.write(
            `550 5.1.1 <${ADDRESS}>: Recipient address rejected\r\n`,
          );
        } else if (verb === "QUIT") {
          socket.end("221 Bye\r\n");
        } else {
          socket.write("250 Ok\r\n");
        }
      }
    });
  });
}

describe("mail delivery errors (NFR-2)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = refusingServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
  });

  afterAll(() => {
    server.close();
  });

  it("keeps the recipient out of what a refused message throws", async () => {
    const mailer = new SmtpMailer({
      smtpUrl: `smtp://127.0.0.1:${String(port)}`,
      from: "GoLiveBoard <no-reply@goliveboard.example>",
    });

    const error: unknown = await mailer
      .send({ to: ADDRESS, subject: "Hello", text: "Hello" })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error).toMatchObject({ responseCode: 550, code: "EENVELOPE" });
    expect(everythingIn(error)).not.toContain(ADDRESS);
    expect(everythingIn(error)).not.toContain("private-attendee");
  });

  it("keeps only short codes from any error", () => {
    const raw = Object.assign(
      new Error(`Can't send mail - all recipients were rejected: ${ADDRESS}`),
      {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
        response: `550 <${ADDRESS}> rejected`,
        rejected: [ADDRESS],
      },
    );

    const safe = mailDeliveryError(raw);

    expect(safe).toMatchObject({
      code: "EENVELOPE",
      responseCode: 550,
      command: "RCPT TO",
    });
    expect(everythingIn(safe)).not.toContain(ADDRESS);
  });

  it("drops a code or command that could hold text", () => {
    const safe = mailDeliveryError({
      code: `EENVELOPE ${ADDRESS}`,
      command: `RCPT TO:<${ADDRESS}>`,
      responseCode: "550",
    });

    expect(safe).toMatchObject({
      code: undefined,
      command: undefined,
      responseCode: undefined,
    });
  });
});
