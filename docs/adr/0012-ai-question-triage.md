# ADR-0012: AI question triage with human confirmation and evaluations

- Status: Accepted (amended 2026-11-17: the SDK, see below)
- Date: 2026-11-09

## Context

During busy events, hundreds of questions arrive and many repeat each other. Moderators need help grouping duplicates and choosing what to answer next. A language model is good at this, but its output can be wrong, malformed or slow, the provider can fail, and attendee data must be protected.

## Decision

- Triage runs as a background job started by a moderator. It sends **only questions' text, under short labels** (q1, q2…), never IDs, names or emails; angle brackets in the text are escaped, so a question cannot close the block it is sent in.
- The model is called through the official Anthropic SDK, behind OpsPilot's own `TriageModel` interface, with a Zod schema for structured output (groups, representative question, reason, suggested order). Questions are named by short labels (q1, q2…), never by their IDs. The result is validated again: every question must be one of those sent, none in two groups.
- **Nothing changes until a moderator confirms**; confirmed merges are applied in one transaction and audited.
- An 8-second timeout and any provider error leave Q&A fully usable, with the panel showing that suggestions are unavailable.
- Each run stores model, latency, token counts and cost; demo workspaces have a daily budget.
- An evaluation suite of fixed question sets with expected groupings runs in CI against recorded responses and against the live model before releases.

## Consequences

- AI improves moderation without becoming a single point of failure or an unreviewed actor.
- Model or prompt changes are measurable through the evaluation score.
- Another provider is another implementation of `TriageModel`; the run, its checks, timeout and records do not change. `AI_PROVIDER` chooses among those built (`none`, `anthropic`, and `offline` for development and tests).

## Alternatives considered

- **Automatic merging without review**: faster, but a wrong merge hides a real question during a live event.
- **Embedding similarity only**: cheaper and deterministic, but weaker at judging intent and cannot suggest an order; possible future pre-filter.
- **The Vercel AI SDK** (this ADR's first decision): provider switching by configuration, but one more abstraction between the code and the model's own features (structured outputs, refusals and their fallback, typed errors).
- **A provider-specific SDK used directly**: fewest abstractions, but the code would depend on one vendor everywhere.

## Amendment (2026-11-17)

The first decision named the Vercel AI SDK. Milestone 8 uses the official Anthropic SDK instead, behind an interface of OpsPilot's own (`TriageModel`), so the vendor appears in one adapter, and the model's structured outputs, refusal handling (the API's server-side fallback) and typed errors are used as documented. Switching provider means writing an adapter, not changing the run.
