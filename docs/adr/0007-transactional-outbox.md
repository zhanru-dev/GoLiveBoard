# ADR-0007: Transactional outbox with BullMQ

- Status: Accepted
- Date: 2026-11-09

## Context

Changes trigger side effects: emails, webhooks, reminders, AI runs, report generation. If the side effect is queued before the transaction commits, a rollback leaves a phantom job; if after, a crash between commit and enqueue loses it.

## Decision

Services write an `OutboxMessage` row in the **same transaction** as the change. A relay in the worker claims undispatched rows with `FOR UPDATE SKIP LOCKED`, enqueues BullMQ jobs and marks the rows dispatched. Job handlers are idempotent, so a job enqueued twice (after a relay crash) has no extra effect. Trace context is stored with the message so one trace links the request and its jobs.

## Consequences

- A side effect happens if and only if the change committed (at least once, made effectively once by idempotent handlers).
- A short delay (under a second) between commit and side effect.
- Every job handler must state how it is idempotent, and tests run each handler twice.

## Alternatives considered

- **Enqueue directly from services**: simpler, but loses or invents jobs around failures.
- **PostgreSQL `LISTEN/NOTIFY` only**: notifications are lost if no listener is connected.
- **A message broker (SQS, RabbitMQ)**: adds infrastructure without removing the need for an outbox.
