# ADR-0006: PostgreSQL with Prisma; database-enforced invariants

- Status: Accepted
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
