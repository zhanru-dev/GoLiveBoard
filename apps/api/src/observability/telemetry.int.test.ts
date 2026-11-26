import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import {
  type AddressInfo,
  createServer as createTcpServer,
  type Socket,
} from "node:net";
import { fileURLToPath } from "node:url";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ACCESS_COOKIE } from "../auth/cookies.js";
import { ApiClient } from "../testing/api-client.js";
import { TEST_ENV, TEST_ORIGIN } from "../testing/config.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createEvent } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";

/** A trace a browser started (W3C example IDs). */
const BROWSER_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const API_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

interface ExportedSpan {
  readonly service: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly scope: string;
  readonly attributes: Record<string, unknown>;
}

interface OtlpAttribute {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

const attributesOf = (list: readonly OtlpAttribute[] = []) =>
  Object.fromEntries(
    list.map(({ key, value }) => [key, Object.values(value)[0]]),
  );

/** An OTLP/HTTP collector on 127.0.0.1 that keeps what it is sent (JSON). */
class FakeCollector {
  readonly bodies: string[] = [];
  readonly metricBodies: string[] = [];
  readonly logBodies: string[] = [];
  /** Each signal's request headers, as sent. */
  readonly headers = new Map<string, Record<string, unknown>>();
  private readonly server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (request.url === "/v1/traces") {
        this.bodies.push(body);
      }
      if (request.url === "/v1/metrics") {
        this.metricBodies.push(body);
      }
      if (request.url === "/v1/logs") {
        this.logBodies.push(body);
      }
      this.headers.set(request.url ?? "", { ...request.headers });
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
          resource: { attributes?: OtlpAttribute[] };
          scopeSpans: {
            scope: { name: string };
            spans: {
              traceId: string;
              spanId: string;
              parentSpanId?: string;
              name: string;
              attributes?: OtlpAttribute[];
            }[];
          }[];
        }[];
      };
      return parsed.resourceSpans.flatMap(({ resource, scopeSpans }) => {
        const service = String(
          attributesOf(resource.attributes)["service.name"],
        );
        return scopeSpans.flatMap(({ scope, spans }) =>
          spans.map((span) => ({
            service,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            scope: scope.name,
            attributes: attributesOf(span.attributes),
          })),
        );
      });
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

/** A process of the compiled API package, started as in production. */
class Started {
  output = "";
  private readonly exited: Promise<unknown>;

  constructor(readonly child: ChildProcess) {
    this.exited = once(child, "exit");
    const keep = (chunk: Buffer) => {
      this.output += chunk.toString("utf8");
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
  }

  /** Its JSON log lines. */
  lines(): Record<string, unknown>[] {
    return this.output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async waitFor(ready: () => Promise<boolean> | boolean, what: string) {
    const deadline = Date.now() + 30_000;
    while (!(await ready())) {
      if (Date.now() > deadline || this.child.exitCode !== null) {
        throw new Error(`${what} did not start:\n${this.output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Stops it as a deploy does (SIGTERM), killing it if it hangs. */
  async stop(): Promise<void> {
    if (this.child.exitCode !== null) {
      return;
    }
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 15_000);
    await this.exited;
    clearTimeout(timer);
  }
}

function start(
  entry: "dist/main.js" | "dist/worker.js",
  env: Record<string, string | undefined>,
): Started {
  return new Started(
    spawn(process.execPath, ["--import", "./dist/telemetry.js", entry], {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function processEnv(
  database: TestDatabase,
  endpoint: string,
): Record<string, string> {
  return {
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
    TRUST_PROXY_HOPS: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_METRIC_EXPORT_INTERVAL: "1000",
  };
}

async function startApi(env: Record<string, string>) {
  const port = await freePort();
  const base = `http://127.0.0.1:${String(port)}`;
  const api = start("dist/main.js", { ...env, API_PORT: String(port) });
  await api.waitFor(async () => {
    const live = await fetch(`${base}/api/v1/health/live`).catch(
      () => undefined,
    );
    return live?.ok === true;
  }, "The API");
  return { api, base };
}

beforeAll(() => {
  // The processes run what was compiled: build it as CI's image would.
  execFileSync("npm", ["run", "build", "-w", "@goliveboard/contracts"], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  });
  execFileSync("npm", ["run", "build", "-w", "@goliveboard/api"], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  });
}, 240_000);

/**
 * NFR-7 and ADR-0011, on the compiled API started as in production:
 * `node --import ./dist/telemetry.js dist/main.js`. Instrumentation that
 * loads too late, or not at all for ES modules, shows only here.
 */
describe("tracing in the running API", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  const collector = new FakeCollector();
  let api: Started;
  let base: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    const endpoint = await collector.start();
    ({ api, base } = await startApi({
      ...processEnv(database, endpoint),
      // Spans leave only when the process stops: that proves the flush.
      OTEL_BSP_SCHEDULE_DELAY: "600000",
      // How Grafana Cloud's token is given (docs/06, section 7).
      OTEL_EXPORTER_OTLP_HEADERS: "x-otlp-test=from-the-environment",
    }));
  }, 60_000);

  afterAll(async () => {
    await api.stop();
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
          // As the browser's API client sends it.
          traceparent: `00-${BROWSER_TRACE}-00f067aa0ba902b7-01`,
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
    await api.stop();

    const spans = collector.spans();
    const server = spans.find(
      (span) =>
        span.scope.endsWith("instrumentation-http") &&
        span.attributes["http.route"] === "/api/v1/auth/sign-in",
    );
    expect(server, api.output).toBeDefined();
    expect(server?.service).toBe("goliveboard-api");
    // The trace the browser started goes on in the API.
    expect(server?.traceId).toBe(BROWSER_TRACE);
    expect(server?.parentSpanId).toBe("00f067aa0ba902b7");
    const inTrace = spans.filter((span) => span.traceId === server?.traceId);
    const scopes = new Set(inTrace.map(({ scope }) => scope.split("/").pop()));
    expect(scopes).toContain("instrumentation-express");
    expect(scopes).toContain("instrumentation-pg");
    expect(scopes).toContain("instrumentation-ioredis");
    // The log line of the request carries the same trace.
    const completed = api
      .lines()
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
    // Request rate, errors and duration per route (docs/06, section 7),
    // without the visitor's address.
    // The request's log lines leave too, as log records in its trace
    // (Loki in Grafana Cloud), redacted as pino wrote them.
    const logs = collector.logBodies.join("\n");
    expect(logs).toContain("request completed");
    expect(logs).toContain(BROWSER_TRACE);
    expect(logs).not.toContain("traced.person");
    expect(logs).not.toContain("not the right password");
    expect(logs).not.toContain("supersecret");
    // Every signal carries the headers from the environment.
    for (const signal of ["/v1/traces", "/v1/metrics", "/v1/logs"]) {
      expect(collector.headers.get(signal)?.["x-otlp-test"], signal).toBe(
        "from-the-environment",
      );
    }
    const metrics = collector.metricBodies.join("\n");
    expect(metrics).toContain("http.server.request.duration");
    expect(metrics).toContain("/api/v1/auth/sign-in");
    expect(metrics).not.toContain("203.0.113.77");
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

/**
 * NFR-7: one trace follows a request from the API, through the outbox and
 * its queue, into the job the worker runs for it.
 */
describe(
  "one trace from a request to the worker's job",
  { timeout: 60_000 },
  () => {
    let database: TestDatabase;
    const collector = new FakeCollector();
    let helper: NestExpressApplication;
    let api: Started;
    let worker: Started;
    let base: string;

    beforeAll(async () => {
      database = await createTestDatabase();
      const endpoint = await collector.start();
      const env = {
        ...processEnv(database, endpoint),
        OTEL_BSP_SCHEDULE_DELAY: "100",
      };
      ({ api, base } = await startApi(env));
      worker = start("dist/worker.js", env);
      await worker.waitFor(
        () => worker.lines().some((line) => line.msg === "Worker started"),
        "The worker",
      );
      // Accounts and events are set up in process, on the same database.
      helper = await createTestApp({
        env: {
          DATABASE_URL: database.url,
          VALKEY_URL: inject("valkeyUrl"),
          TRUST_PROXY_HOPS: "1",
        },
        mailer: new CapturingMailer(),
      });
    }, 90_000);

    afterAll(async () => {
      await api.stop();
      await worker.stop();
      await helper.close();
      await collector.stop();
      await database.drop();
    });

    const transitionSpan = () =>
      collector
        .spans()
        .find(
          (span) =>
            span.service === "goliveboard-api" &&
            span.attributes["http.route"] ===
              "/api/v1/events/:eventId/transitions",
        );

    it("continues the request's trace in the job its outbox message started", async () => {
      const client = new ApiClient(helper, "198.18.30.1");
      const owner = await client.newOwner();
      const event = await createEvent(client, owner);

      // Through the running API: the transition writes an outbox message.
      const moved = await fetch(
        `${base}/api/v1/events/${event.id}/transitions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: TEST_ORIGIN,
            cookie: `${ACCESS_COOKIE}=${owner.access}`,
          },
          body: JSON.stringify({ to: "CONFIGURING" }),
        },
      );
      expect(moved.status, await moved.clone().text()).toBe(200);

      await expect.poll(transitionSpan, { timeout: 10_000 }).toBeDefined();
      const traceId = transitionSpan()?.traceId;
      // The worker relays the message and processes its job in that trace.
      await expect
        .poll(
          () =>
            collector
              .spans()
              .filter(
                (span) =>
                  span.traceId === traceId &&
                  span.service === "goliveboard-worker",
              )
              .map(({ name }) => name),
          { timeout: 15_000 },
        )
        .toEqual(expect.arrayContaining([expect.stringMatching(/process/)]));
      const [row] = await database.query<{ trace_context: unknown }>(
        "SELECT trace_context FROM outbox_messages WHERE type = 'event.transitioned'",
      );
      expect(row?.trace_context).toMatchObject({
        traceparent: expect.stringContaining(traceId ?? "none") as unknown,
      });
    });

    it("takes only the parent from a visitor's trace headers: not their sampling, baggage or tracestate", async () => {
      const client = new ApiClient(helper, "198.18.30.2");
      const owner = await client.newOwner();
      const event = await createEvent(client, owner);
      const visitorTrace = "0af7651916cd43dd8448eb211c80319c";

      const moved = await fetch(
        `${base}/api/v1/events/${event.id}/transitions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: TEST_ORIGIN,
            cookie: `${ACCESS_COOKIE}=${owner.access}`,
            // "Do not record this", with data for the outbox and onwards.
            traceparent: `00-${visitorTrace}-b7ad6b7169203331-00`,
            tracestate: "visitor=chosen-by-the-browser",
            baggage: "injected=from-the-browser",
          },
          body: JSON.stringify({ to: "CONFIGURING" }),
        },
      );
      expect(moved.status, await moved.clone().text()).toBe(200);

      // Recorded all the same, under the visitor's trace.
      await expect
        .poll(
          () =>
            collector
              .spans()
              .some(
                (span) =>
                  span.traceId === visitorTrace &&
                  span.attributes["http.route"] ===
                    "/api/v1/events/:eventId/transitions",
              ),
          { timeout: 10_000 },
        )
        .toBe(true);
      const [row] = await database.query<{ trace_context: unknown }>(
        "SELECT trace_context FROM outbox_messages WHERE payload->>'eventId' = $1 AND type = 'event.transitioned'",
        [event.id],
      );
      // The outbox keeps the traceparent alone, marked as recorded.
      expect(row?.trace_context).toEqual({
        traceparent: expect.stringMatching(
          new RegExp(`^00-${visitorTrace}-[0-9a-f]{16}-01$`),
        ) as unknown,
      });
    });
  },
);

/**
 * A collector that accepts connections and never answers: the stop must
 * not wait for it beyond its time limit (Docker kills after 10 seconds).
 */
describe(
  "stopping while the collector does not answer",
  { timeout: 60_000 },
  () => {
    let database: TestDatabase;
    const sockets = new Set<Socket>();
    const silent = createTcpServer((socket) => {
      sockets.add(socket);
    });

    beforeAll(async () => {
      database = await createTestDatabase();
      silent.listen(0, "127.0.0.1");
      await once(silent, "listening");
    });

    afterAll(async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      silent.close();
      await database.drop();
    });

    it("stops within a few seconds, telemetry given up rather than waited for", async () => {
      const { port } = silent.address() as AddressInfo;
      const { api, base } = await startApi({
        ...processEnv(database, `http://127.0.0.1:${String(port)}`),
        // Everything queued is sent at the stop.
        OTEL_BSP_SCHEDULE_DELAY: "600000",
        OTEL_METRIC_EXPORT_INTERVAL: "600000",
      });
      const signIn = await fetch(`${base}/api/v1/auth/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: JSON.stringify({
          email: "a@example.com",
          password: "x".repeat(12),
        }),
      });
      expect(signIn.status).toBe(401);

      const stopping = Date.now();
      await api.stop();
      const took = Date.now() - stopping;

      expect(api.child.signalCode, api.output).not.toBe("SIGKILL");
      // And says what it gave up.
      expect(api.output).toContain("Telemetry not sent in time");
      // TELEMETRY_STOP_MS is 2 seconds; the exporters alone would wait 10.
      expect(took, api.output).toBeLessThan(6_000);
    });
  },
);
