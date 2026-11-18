import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { TEST_ENV, TEST_ORIGIN } from "../testing/config.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";

const API_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

interface ExportedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly scope: string;
  readonly attributes: Record<string, unknown>;
}

/** An OTLP/HTTP collector on 127.0.0.1 that keeps what it is sent (JSON). */
class FakeCollector {
  readonly bodies: string[] = [];
  private readonly server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (request.url === "/v1/traces") {
        this.bodies.push(body);
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  async start(): Promise<string> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}`;
  }

  spans(): ExportedSpan[] {
    return this.bodies.flatMap((body) => {
      const parsed = JSON.parse(body) as {
        resourceSpans: {
          scopeSpans: {
            scope: { name: string };
            spans: {
              traceId: string;
              spanId: string;
              parentSpanId?: string;
              name: string;
              attributes?: { key: string; value: Record<string, unknown> }[];
            }[];
          }[];
        }[];
      };
      return parsed.resourceSpans.flatMap(({ scopeSpans }) =>
        scopeSpans.flatMap(({ scope, spans }) =>
          spans.map((span) => ({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            scope: scope.name,
            attributes: Object.fromEntries(
              (span.attributes ?? []).map(({ key, value }) => [
                key,
                Object.values(value)[0],
              ]),
            ),
          })),
        ),
      );
    });
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }
}

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

/**
 * NFR-7 and ADR-0011, on the compiled API started as in production:
 * `node --import ./dist/telemetry.js dist/main.js`. Instrumentation that
 * loads too late, or not at all for ES modules, shows only here.
 */
describe("tracing in the running API", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  const collector = new FakeCollector();
  let api: ChildProcess;
  let output = "";
  let base: string;

  beforeAll(async () => {
    // The process runs what was compiled: build it as CI's image would.
    execFileSync("npm", ["run", "build", "-w", "@opspilot/contracts"], {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
    execFileSync("npm", ["run", "build", "-w", "@opspilot/api"], {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
    database = await createTestDatabase();
    const endpoint = await collector.start();
    const port = await freePort();
    base = `http://127.0.0.1:${String(port)}`;
    api = spawn(
      process.execPath,
      ["--import", "./dist/telemetry.js", "dist/main.js"],
      {
        cwd: API_ROOT,
        env: {
          PATH: process.env.PATH,
          ...TEST_ENV,
          LOG_LEVEL: "info",
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          S3_ENDPOINT: inject("s3Endpoint"),
          S3_BUCKET: TEST_S3_BUCKET,
          S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
          S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
          S3_FORCE_PATH_STYLE: "true",
          S3_CREATE_BUCKET: "true",
          API_PORT: String(port),
          TRUST_PROXY_HOPS: "1",
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          // Spans leave only when the process stops: that proves the flush.
          OTEL_BSP_SCHEDULE_DELAY: "600000",
          OTEL_METRICS_EXPORTER: "none",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    api.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    api.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const live = await fetch(`${base}/api/v1/health/live`).catch(
        () => undefined,
      );
      if (live?.ok === true) {
        break;
      }
      if (Date.now() > deadline || api.exitCode !== null) {
        throw new Error(`The API did not start:\n${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 240_000);

  afterAll(async () => {
    if (api.exitCode === null) {
      api.kill("SIGKILL");
    }
    await collector.stop();
    await database.drop();
  });

  it("traces a request through Express, PostgreSQL and Valkey as one trace, logged with its ID, and leaks no token, address or email", async () => {
    const signIn = await fetch(
      `${base}/api/v1/auth/sign-in?token=one-time-supersecret`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN,
          "x-forwarded-for": "203.0.113.77",
        },
        body: JSON.stringify({
          email: "traced.person@example.com",
          password: "not the right password at all",
        }),
      },
    );
    expect(signIn.status).toBe(401);

    // The real-time gateway polls PostgreSQL every second (M6): give it
    // time to, so its queries are among what is exported.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    // Stopping flushes what is queued (OTEL_BSP_SCHEDULE_DELAY is ten minutes).
    api.kill("SIGTERM");
    await once(api, "exit");

    const spans = collector.spans();
    const server = spans.find(
      (span) =>
        span.scope.endsWith("instrumentation-http") &&
        span.attributes["http.route"] === "/api/v1/auth/sign-in",
    );
    expect(server, output).toBeDefined();
    const inTrace = spans.filter((span) => span.traceId === server?.traceId);
    const scopes = new Set(inTrace.map(({ scope }) => scope.split("/").pop()));
    expect(scopes).toContain("instrumentation-express");
    expect(scopes).toContain("instrumentation-pg");
    expect(scopes).toContain("instrumentation-ioredis");
    // The log line of the request carries the same trace.
    const completed = output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find(
        (line) =>
          line.msg === "request completed" &&
          (line.req as { path?: string } | undefined)?.path ===
            "/api/v1/auth/sign-in",
      );
    expect(completed?.trace_id).toBe(server?.traceId);
    // Nothing that identifies a person or opens a door left the process.
    const exported = collector.bodies.join("\n");
    expect(exported).not.toContain("supersecret");
    expect(exported).not.toContain("203.0.113.77");
    expect(exported).not.toContain("traced.person");
    expect(exported).not.toContain("not the right password");
  });

  it("starts no trace for health checks or for the pollers that run every second", () => {
    const spans = collector.spans();

    expect(
      spans.filter((span) => {
        const path = span.attributes["url.path"];
        return typeof path === "string" && path.includes("/health/");
      }),
    ).toEqual([]);
    // Every database and Valkey span belongs to a request or a job.
    const roots = spans.filter((span) => span.parentSpanId === undefined);
    expect(
      roots.filter(({ scope }) => !scope.endsWith("instrumentation-http")),
    ).toEqual([]);
  });
});
