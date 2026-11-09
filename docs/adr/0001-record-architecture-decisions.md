# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-11-09

## Context

Decisions made early shape the whole system, and the reasons for them are easily forgotten. New contributors — and interviewers — ask "why is it built this way?". Code shows _what_ was done, not _why_, nor which alternatives were rejected.

## Decision

Significant, hard-to-reverse decisions are recorded as ADRs in `docs/adr/`, one file per decision, using the template in the index. An ADR is written in the same pull request as the change it describes.

## Consequences

- The reasoning behind the architecture is reviewable and survives changes of people.
- Writing an ADR forces alternatives to be considered before committing.
- Small, easily reversed choices do not need ADRs; deciding which is which is part of review.

## Alternatives considered

- **Wiki pages**: drift away from the code and are not reviewed with it.
- **Comments in code**: good for local reasoning, but cross-cutting decisions have no single home.
