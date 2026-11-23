# Development documentation

These documents define what OpsPilot is, how it is built and how it is delivered. They are the contract for the implementation: when the code and a document disagree, one of them is wrong, and the fix goes in the same pull request.

## Reading order

1. **[Product requirements](01-product-requirements.md)** — what we build and why. Every feature traces back to a step of the golden flow and to a requirement ID (`FR-…`, `NFR-…`).
2. **[Architecture](02-architecture.md)** — the shape of the system and the technology chosen for each part.
3. **[Domain and data model](03-domain-and-data-model.md)** — the business concepts, their rules and how the database enforces them.
4. **[API and contracts](04-api-and-contracts.md)** — how clients talk to the system: HTTP, WebSockets, server-sent events and webhooks.
5. **[Engineering standards](05-engineering-standards.md)** — how code is written, tested, reviewed and merged.
6. **[Infrastructure and operations](06-infrastructure-and-operations.md)** — how it runs locally, in CI and on AWS, and how it is observed.
7. **[Delivery plan](07-delivery-plan.md)** — the order of work, with exit criteria per milestone.
8. **[Architecture decision records](adr/README.md)** — the reasoning behind significant decisions, including the options we rejected.

## Evidence

What milestone 9 measured and checked, kept next to the documents it holds to account:

- **[Load test](load-tests/2026-11-18-nfr4-local.md)** — NFR-4 (chat delivery under load), with the k6 script in `load/`.
- **[Lighthouse scores](lighthouse.md)** — the public event page against its budgets (NFR-3).
- **[Accessibility audit](accessibility-audit.md)** — WCAG 2.2 AA, criterion by criterion, with the keyboard walkthrough; the [screen-reader pass](screen-reader-pass.md) is the script for listening to it.
- **[Security review](security-review.md)** — OWASP ASVS 5.0 level 2, with a ZAP scan.
- **[Runbooks](runbooks/README.md)** — what to do when something goes wrong, each rehearsed once.

## Conventions used in these documents

- **Requirement IDs** — `FR-<area>-<n>` for functional requirements and `NFR-<n>` for non-functional ones. Tests, pull requests and ADRs reference them.
- **MUST / SHOULD / MAY** — used in the sense of [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
- **Diagrams** — written in Mermaid, so they live in version control next to the text they explain.
- **Versions** — technology versions are those current in November 2026. Patch versions are pinned by the lock file, not by these documents.
- **Language** — British English.

## Keeping the documents current

A pull request that changes behaviour described here MUST update the affected document. A pull request that makes a significant, hard-to-reverse decision MUST add an ADR. Superseded decisions are not deleted: the old ADR is marked _Superseded by ADR-NNNN_.
