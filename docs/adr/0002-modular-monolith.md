# ADR-0002: Modular monolith with a separate worker process

- Status: Accepted
- Date: 2026-11-09

## Context

The backend has about fifteen business areas, strict consistency needs across them (a transition writes the event, an audit entry and an outbox message atomically), one small team, and a capacity target of 500 concurrent attendees per event. Background work (email, webhooks, stream checks, AI calls) must not slow down HTTP requests.

## Decision

Build the backend as one NestJS codebase (`apps/api`) organised into feature modules with enforced boundaries, deployed as two processes from two entry points: `api` (HTTP, WebSocket, SSE) and `worker` (BullMQ consumers and repeatable jobs). Both share one PostgreSQL database.

## Consequences

- Cross-module consistency uses ordinary database transactions.
- One build, one deployment, one set of tests; local development stays simple.
- The worker scales independently, and a slow job never blocks a request.
- Module boundaries must be policed (dependency-cruiser in CI), or the codebase degrades into a tangle.

## Alternatives considered

- **Microservices**: independent scaling and deployment that this product does not need, at the cost of distributed transactions, network failure modes and much more infrastructure.
- **Single process doing everything**: simpler still, but long-running jobs would compete with request handling, and graceful shutdown becomes harder.
- **Next.js route handlers as the whole backend**: workable for simple CRUD, but a poor fit for WebSockets, long-running workers and a large modular domain.
