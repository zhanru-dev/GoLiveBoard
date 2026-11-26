import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config/app-config.js";
import type { ErrorReporter } from "./error-reporting.js";
import { createLogger } from "./logger.js";

const CONFIG = loadConfig({
  DATABASE_URL: "postgres://goliveboard:secret@127.0.0.1:5443/goliveboard",
  VALKEY_URL: "redis://127.0.0.1:6392",
  APP_ORIGIN: "http://localhost:3300",
  JWT_SECRET: "a".repeat(32),
  SMTP_URL: "smtp://127.0.0.1:1036",
  MAIL_FROM: "GoLiveBoard <no-reply@goliveboard.test>",
});

/** A logger writing into an array, with a spy for reported errors. */
function setUp(level = CONFIG.log.level) {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const reporter = vi.fn<ErrorReporter>();
  const logger = createLogger(
    { ...CONFIG, log: { ...CONFIG.log, level } },
    sink,
    reporter,
  );
  return { logger, lines, reporter };
}

describe("error reporting through the logger", () => {
  it("reports an error logged with its err, with the line's message", () => {
    const { logger, reporter } = setUp();
    const error = new Error("connection refused");

    logger.error({ err: error }, "Outbox relay round failed");

    expect(reporter).toHaveBeenCalledExactlyOnceWith(error, {
      message: "Outbox relay round failed",
      requestId: undefined,
    });
  });

  it("reports an error logged on its own, under its own message", () => {
    const { logger, reporter } = setUp();
    const error = new Error("boom");

    logger.fatal(error);

    expect(reporter).toHaveBeenCalledExactlyOnceWith(error, {
      message: "boom",
      requestId: undefined,
    });
  });

  it("names the request a request-scoped logger belongs to", () => {
    const { logger, reporter } = setUp();
    const error = new Error("unexpected");

    logger
      .child({ req: { id: "req-123", method: "GET", path: "/x" } })
      .error({ err: error }, "Unhandled error");

    expect(reporter).toHaveBeenCalledWith(error, {
      message: "Unhandled error",
      requestId: "req-123",
    });
  });

  it("does not report warnings, even with an error attached", () => {
    const { logger, reporter } = setUp();

    logger.warn({ err: new Error("retrying") }, "Could not delete a file");

    expect(reporter).not.toHaveBeenCalled();
  });

  it("does not report error lines without an error, such as a 500's summary", () => {
    const { logger, reporter } = setUp();

    logger.error({ res: { statusCode: 500 } }, "request completed");
    logger.error({ err: "not an Error" }, "Odd failure");

    expect(reporter).not.toHaveBeenCalled();
  });

  it("still logs the line when reporting fails", () => {
    const { logger, lines, reporter } = setUp();
    reporter.mockImplementation(() => {
      throw new Error("Sentry is down");
    });

    logger.error({ err: new Error("boom") }, "Unhandled error");

    expect(lines).toEqual([
      expect.objectContaining({ level: 50, msg: "Unhandled error" }),
    ]);
  });

  it("reports nothing the log level silences", () => {
    const { logger, reporter } = setUp("silent");

    logger.error({ err: new Error("boom") }, "Unhandled error");

    expect(reporter).not.toHaveBeenCalled();
  });
});
