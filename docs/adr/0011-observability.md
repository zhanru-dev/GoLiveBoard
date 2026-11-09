# ADR-0011: OpenTelemetry and Sentry for observability

- Status: Accepted
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
