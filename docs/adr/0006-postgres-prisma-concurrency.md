# ADR-0006: PostgreSQL with Prisma; database-enforced invariants

- Status: Accepted (amended 2026-11-22: where raw SQL lives, see below)
- Date: 2026-11-09

## Context

Several requirements must hold under concurrent requests: no transition past a hard blocker, no lost updates, at most three pinned questions, one vote per attendee, gap-free real-time sequences, single-use tokens. Application checks alone cannot guarantee these when two requests interleave.

## Decision

Use PostgreSQL 18 as the system of record and Prisma ORM 7 (with the `pg` driver adapter) for typed queries and migrations. Concurrency rules are enforced by the database:

- constraints and partial unique indexes for limits and uniqueness;
- `SELECT … FOR UPDATE` on the parent row for state transitions;
- `version` columns compared in the `UPDATE` for optimistic concurrency;
- conditional updates for single-use tokens and refresh-token rotation;
- `FOR UPDATE SKIP LOCKED` for the outbox relay.

Raw SQL for locks and aggregates lives in named, tested `*.queries.ts` files.

## Consequences

- Invariants hold regardless of how many API instances run.
- Each invariant has a race test that fires concurrent requests and asserts the outcome.
- Some queries bypass Prisma's query builder; they must stay few and well-tested.

## Alternatives considered

- **Drizzle ORM**: closer to SQL and lighter; Prisma chosen for its migration workflow, readability for learners and wider adoption.
- **Application-level locks in Valkey**: another moving part that can fail independently of the data it protects.
- **Serializable isolation everywhere**: correct, but turns ordinary contention into retry storms; targeted locks are clearer.

## Amendment (2026-11-22)

Reviewed at the end of milestone 9. The database-enforced rules stand as decided, and each lock that guards a race has a test that forces the overlap and fails without it.

One sentence did not survive contact: "raw SQL for locks and aggregates lives in named, tested `*.queries.ts` files". Only the queries several services share live in such files (`event-lock.queries.ts`, `invitation.queries.ts`, `runbook.queries.ts`). The rest, in about thirty services, sit next to the code that uses them: the lock and the statement it protects read better together. They are written as Prisma's tagged templates (`$queryRaw`, `$executeRaw`), so every value is a parameter, never spliced into the text, and they are covered by those services' integration tests against a real PostgreSQL. The rule is now: shared queries in a `*.queries.ts` file; a query used in one place stays in that place; `$queryRawUnsafe` is not used.

Two practices were added along the way:

- **Lock strength.** `FOR NO KEY UPDATE` for edits, so inserts of rows that point at the locked one are not held up (docs/03, section 2); `FOR UPDATE` before a delete, so nothing can start pointing at a row that is going away (the webhook endpoints' delete, for example).
- **Advisory locks.** `pg_advisory_xact_lock` is used where no existing row can stand for what is guarded: an idempotency key before its stored response exists, invitations to one address, the AI triage budget per workspace and day, and the demo workspace's reset.
