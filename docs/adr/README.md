# Architecture decision records

An ADR records one significant decision: the context, the decision, its consequences and the options rejected. Once accepted, an ADR's decision is not rewritten: a decision that changes gets a new ADR that supersedes the old one. When the decision stands but building it settled details it left open, or proved a sentence wrong, an **amendment** is appended to the ADR, dated, and its status says so.

| ADR                                           | Decision                                                                  | Status             |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------------ |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions                                             | Accepted           |
| [0002](0002-modular-monolith.md)              | Modular monolith with a separate worker process                           | Accepted           |
| [0003](0003-single-origin.md)                 | Serve web and API from one origin                                         | Accepted           |
| [0004](0004-shared-zod-contracts.md)          | Shared Zod contracts as the single source of truth                        | Accepted (amended) |
| [0005](0005-session-authentication.md)        | Own session authentication with rotating refresh tokens                   | Accepted           |
| [0006](0006-postgres-prisma-concurrency.md)   | PostgreSQL with Prisma; database-enforced invariants                      | Accepted (amended) |
| [0007](0007-transactional-outbox.md)          | Transactional outbox with BullMQ                                          | Accepted           |
| [0008](0008-realtime-transports.md)           | Socket.IO for chat and Q&A, server-sent events for the operations room    | Accepted (amended) |
| [0009](0009-stream-provider-integration.md)   | Integrate with the customer's streaming provider instead of hosting video | Accepted           |
| [0010](0010-aws-deployment.md)                | Single EC2 host with RDS, deployed by Terraform and GitHub OIDC           | Accepted           |
| [0011](0011-observability.md)                 | OpenTelemetry and Sentry for observability                                | Accepted (amended) |
| [0012](0012-ai-question-triage.md)            | AI question triage with human confirmation and evaluations                | Accepted (amended) |

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-NNNN
- Date: YYYY-MM-DD

## Context

What forces are at play? What problem needs a decision?

## Decision

What we will do, stated plainly.

## Consequences

What becomes easier, what becomes harder, what we must now do.

## Alternatives considered

Each option and why it was not chosen.
```
