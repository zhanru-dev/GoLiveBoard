# ADR-0012: AI question triage with human confirmation and evaluations

- Status: Accepted
- Date: 2026-11-09

## Context

During busy events, hundreds of questions arrive and many repeat each other. Moderators need help grouping duplicates and choosing what to answer next. A language model is good at this, but its output can be wrong, malformed or slow, the provider can fail, and attendee data must be protected.

## Decision

- Triage runs as a background job started by a moderator. It sends **only question IDs and texts**, never names or emails.
- The model is called through the Vercel AI SDK with a Zod schema for structured output (groups, representative question, reason, suggested order). The result is validated again: every ID must exist in the input set.
- **Nothing changes until a moderator confirms**; confirmed merges are applied in one transaction and audited.
- An 8-second timeout and any provider error leave Q&A fully usable, with the panel showing that suggestions are unavailable.
- Each run stores model, latency, token counts and cost; demo workspaces have a daily budget.
- An evaluation suite of fixed question sets with expected groupings runs in CI against recorded responses and against the live model before releases.

## Consequences

- AI improves moderation without becoming a single point of failure or an unreviewed actor.
- Model or prompt changes are measurable through the evaluation score.
- The provider can be switched by configuration.

## Alternatives considered

- **Automatic merging without review**: faster, but a wrong merge hides a real question during a live event.
- **Embedding similarity only**: cheaper and deterministic, but weaker at judging intent and cannot suggest an order; possible future pre-filter.
- **A provider-specific SDK**: fewer abstractions, but locks the product to one vendor.
