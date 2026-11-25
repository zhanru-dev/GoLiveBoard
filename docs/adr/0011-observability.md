# ADR-0011: OpenTelemetry and Sentry for observability

- Status: Accepted (amended 2026-11-19: how it was built, see below)
- Date: 2026-11-09

## Context

A live event cannot wait for someone to reproduce a problem. We need to follow one request from the browser through the API into background jobs, see errors with their context, and alert on symptoms. NestJS 12 ships its own observability SDK, but it only covers the NestJS application and does not correlate with the web app or the worker's jobs out of the box.

## Decision

- **OpenTelemetry** SDK in the Next.js server, the API and the worker, with automatic HTTP, PostgreSQL and Valkey instrumentation and manual spans for business operations. Trace context is propagated through HTTP headers and stored with outbox messages and job payloads. Data goes to an OpenTelemetry Collector and on to a hosted backend (Grafana Cloud); locally to the `grafana/otel-lgtm` container.
- **pino** for structured JSON logs that carry the trace ID.
- **Sentry** for error tracking in the browser and on every server process, tagged with the release.

## Consequences

- Vendor-neutral instrumentation: the backend can change without touching application code.
- One trace links a page request, the API call, the database queries and the jobs it caused.
- Instrumentation must be initialised before other imports in each process; this is tested at startup.

## Alternatives considered

- **`@nestjs/observe`**: convenient for the API alone, but no cross-stack correlation.
- **Logs only**: cannot show where time goes across services and jobs.
- **A single commercial APM agent**: quick to start, but proprietary instrumentation and higher cost.

## Amendment (2026-11-19)

Milestone 9 built this decision. Four choices the original text did not settle, and one it got wrong:

- **The browser starts the trace with a `traceparent` header, not an OpenTelemetry web SDK.** The browser's API calls send a W3C `traceparent` of their own making. The web SDK would add tens of kilobytes to a public page that has 150 kB of JavaScript in all (docs/05, section 9), and only to time spans the server already records.
- **Sentry does not set up OpenTelemetry.** `@sentry/nextjs` registers its own OpenTelemetry tracer provider by default; the web server switches that off (`enableOpenTelemetrySetup: false`). `@sentry/node`, in the API and the worker, leaves it off by default, and Sentry's tracing is not enabled there. One provider per process, ours, so spans go to one place and are redacted the same way.
- **Instrumentation is loaded with `node --import ./dist/telemetry.js`,** which registers OpenTelemetry's module hook (`module.register`) before the application loads. Node.js 26 deprecates `module.register` in favour of `module.registerHooks`, which OpenTelemetry's instrumentation does not support yet. We use the supported path and revisit it when OpenTelemetry moves.
- **`@opentelemetry/instrumentation-nestjs-core` is not used:** it supports NestJS up to 11. Express routes carry the route name, which is what the dashboards group by.
- **Was wrong: "this is tested at startup".** What is tested is that each process, started as in production, sends spans for a request and for a job (`telemetry.int.test.ts`), and, on the stack, that a click in the browser yields one trace across the API and the worker (`e2e/observability.spec.ts`).

**Spans are redacted before they leave** (`RedactingExporter`): no query strings, no client addresses, no Valkey arguments or SQL values. Business spans carry IDs and outcomes, never personal data.
