# 07 · Delivery plan

OpsPilot is delivered in three phases and ten milestones. Each milestone ends with a working system that runs in production form locally (from Milestone 4 onwards) and has exit criteria that can be checked. Cloud deployment comes last, in Milestone 10, once the product is complete; everything that can differ between development and production is exercised locally and in CI from Milestone 4, so the move to AWS changes the environment, not the code. Requirement IDs refer to [Product requirements](01-product-requirements.md).

Each milestone is built and verified here first, then taught as a series of lessons in which the learner builds the same milestone in their own repository.

## Overview

```mermaid
flowchart LR
  subgraph p1["Phase 1 · Production-ready core"]
    m1["M1 Foundations"] --> m2["M2 Identity"] --> m3["M3 Launch Control"] --> m4["M4 Production readiness"]
  end
  subgraph p2["Phase 2 · Golden flow"]
    m5["M5 Admission"] --> m6["M6 Live interaction"] --> m7["M7 Operations and record"]
  end
  subgraph p3["Phase 3 · Standout"]
    m8["M8 AI triage"] --> m9["M9 Hardening"] --> m10["M10 Deployment and launch"]
  end
  m4 --> m5
  m7 --> m8
```

| Phase                     | Outcome                                                                                                                | Indicative length at three sessions a week |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1 · Production-ready core | Staff can sign up, prepare an event and get a trustworthy readiness verdict; production images tested end to end in CI | 7–9 weeks                                  |
| 2 · Golden flow           | Attendees register, watch, chat and ask; staff run the event and get a report                                          | 5–7 weeks                                  |
| 3 · Standout              | AI triage with evaluations, observability, load and accessibility evidence, launch materials                           | 3–4 weeks                                  |

## Phase 1 · Production-ready core

### M1 · Foundations

- **Scope**: npm workspaces monorepo on Node.js 26; TypeScript 6.0, ESLint, Prettier, dependency-cruiser; `packages/contracts` with the first schemas and error codes; NestJS 12 API skeleton with configuration validation, problem responses and health endpoints; Next.js 16 app shell; Docker Compose with Caddy, PostgreSQL and Valkey (Mailpit joins in M2, SeaweedFS in M3, each with its first use); readiness checks against PostgreSQL and Valkey; Vitest in every workspace; GitHub Actions quality and test jobs.
- **Exit criteria**: `npm run services:up && npm run dev` serves the web app and `GET /api/v1/health/ready` through one origin on port 3300; CI is green and required on `main`.
- **Teaching notes**: Docker and Compose are learned first in the separate learning folder, then applied here. The course repository started on Node 22, TypeScript 5.9, NestJS 11, Jest and CommonJS; this milestone includes upgrading it to the reference stack (Node 26, TypeScript 6.0, NestJS 12 with ES modules, Vitest), which is itself a realistic exercise.

### M2 · Identity and tenancy

- **Scope**: Mailpit in Docker Compose; Prisma 7 schema and migrations for users, workspaces, memberships, sessions and tokens; FR-WS-1 to FR-WS-4; FR-AUTH-1 to FR-AUTH-4; guards for authentication, workspace and role; rate limiting; sign-in, sign-up, password reset, team and invitation screens.
- **Exit criteria**: integration tests prove refresh-token rotation under concurrency, immediate effect of role changes, and no cross-workspace access; Playwright covers sign-up → invite → accept → sign in.

### M3 · Events and Launch Control

- **Scope**: SeaweedFS in Docker Compose; FR-EV-1 to FR-EV-4, FR-LC-1 to FR-LC-4, FR-ST-1 to FR-ST-3; lifecycle and readiness as pure domain functions; outbox and worker skeleton; stream-check job and incidents; presigned upload of the holding slate; Launch Control and event list screens.
- **Exit criteria**: unit tests cover every readiness rule and transition; a race test proves two concurrent "go live" requests cannot bypass a blocker; the stream check opens and resolves incidents against a controllable test stream.

### M4 · Production readiness

- **Scope**: production Dockerfiles (multi-stage, non-root, arm64) and image scanning; a production-like local stack (`docker-compose.prod.yml`) with Caddy serving HTTPS (`tls internal`), so secure cookies and encrypted WebSockets behave as in production; migrations run before the new version starts; Playwright smoke tests against that stack in CI; Sentry and structured logs; demo mode with seed data, one-click sign-in and nightly reset (FR-AUTH-5).
- **Exit criteria**: CI builds the production images and passes the smoke tests against them over HTTPS; a visitor to the local production stack can sign in to the demo with one click.

## Phase 2 · Golden flow

### M5 · Admission

- **Scope**: FR-AD-1 to FR-AD-6; server-rendered public event page with metadata; registration and verification; access policies and invitations; attendee sessions with per-request eligibility; reminder scheduling; consent recording, retention job and erasure; the demo inbox.
- **Exit criteria**: the public page meets the NFR-3 budget in Lighthouse CI; tests prove no account enumeration, single-use tokens, at-most-once reminders and anonymisation.

### M6 · Live interaction

- **Scope**: FR-RN-1 to FR-RN-5; Socket.IO gateway with the Valkey adapter; sequence journals and catch-up; chat and Q&A with moderation; watch page with hls.js and the holding-slate switch; attendance heartbeats; revocation within 5 seconds.
- **Exit criteria**: Playwright forces a network interruption and proves no lost or duplicated messages; database-enforced pin limit and vote uniqueness hold under concurrent requests.

### M7 · Operations and record

- **Scope**: FR-RN-7, FR-RC-1 to FR-RC-3; operations room over server-sent events with charts; webhook endpoints, signing, retries and the integrations screen; audit search; post-event report and CSV export.
- **Exit criteria**: a webhook receiver test verifies signatures and de-duplication; the report matches hand-calculated figures for a seeded event.

## Phase 3 · Standout

### M8 · AI question triage

- **Scope**: FR-RN-6; provider interface with the Vercel AI SDK; structured output validated against question IDs; moderator review and merge; cost and latency recording; daily budget in demo mode; evaluation suite.
- **Exit criteria**: the evaluation suite runs in CI on recorded responses and meets its agreed score; provider failure and timeout leave Q&A fully usable.

### M9 · Hardening

- **Scope**: end-to-end OpenTelemetry tracing including jobs; dashboards and alerts; k6 load test for NFR-4; full accessibility audit with a keyboard walkthrough; security review against the checklist and OWASP ASVS areas in scope; runbooks; database restore rehearsal.
- **Exit criteria**: load test results and Lighthouse scores recorded in the repository; every runbook exercised once.
- **Recorded**: [load test](load-tests/2026-11-18-nfr4-local.md), [Lighthouse scores](lighthouse.md), [accessibility audit](accessibility-audit.md), [security review](security-review.md), and the [runbooks](runbooks/README.md) with their rehearsals. The load test and the runbooks ran on the local production-like stack; both run again on AWS in milestone 10.

### M10 · Deployment and launch

- **Scope**: Terraform for the AWS demo environment; GitHub OIDC; deploy pipeline with migrations, smoke test and automatic rollback; SES production access and DNS; README with architecture diagram, live link, demo instructions and trade-offs; final ADR review; a two-minute demo video; a real small online event run on OpsPilot, with its report.
- **Exit criteria**: a merge to `main` reaches the demo environment with no manual step; a deliberately failing smoke test rolls back automatically; a reviewer who has never seen the project can understand, run and try it from the README alone.
- **Carried over from M9**: Grafana Cloud in place of the local `grafana/otel-lgtm`, with logs shipped to it; the k6 load test against the AWS environment; each runbook's AWS steps rehearsed there; a screen-reader pass of the golden flow before the public demo.
- **Done before the AWS account** (2026-11-23):
  - the README, for a first-time reader;
  - the final ADR review (0004, 0006, 0008 and 0010 amended);
  - all of `infra/terraform`, checked offline in CI;
  - the deploy pipeline with its automatic rollback, its scripts tested against fakes;
  - mail through SES's API;
  - logs over OTLP, ready for Grafana Cloud;
  - the screen-reader script ([screen-reader-pass.md](screen-reader-pass.md)).
  - error boundaries in the web app, so a rendering error breaks one part, not the page (2026-11-25);
  - Web Vitals and real-time failures from real visits, with a p75 dashboard and two browser-side alerts (2026-11-25).
- **Backlog (not in M10):** a runtime feature flag per workspace (AI triage can already be switched off with `AI_PROVIDER=none`, but only by a deploy), and visual regression tests (screenshots differ across platforms and fonts; costly to keep green for the risk they cover).
- **Still to do:**
  - **with the account:** apply the Terraform, SES production access and DNS, the first deploy and the rollback drill, Grafana Cloud's endpoint and token, the k6 test and the runbooks' AWS steps there;
  - **by a person:** the screen-reader pass, the demo video, a real event and its report.
- **Career milestone**: the full-stack CV goes out with a live link from here.
- **Start early**: open the AWS account, request SES production access and register the domain about a week before this milestone; approvals take days, deployment does not.

## Risks

| Risk                                                                                      | Likelihood | Impact               | Mitigation                                                                                                       |
| ----------------------------------------------------------------------------------------- | ---------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Scope grows during the build                                                              | High       | Delays the live demo | Requirements are fixed per milestone; new ideas go to a backlog, not into the current milestone                  |
| A recent major (Node.js 26, NestJS 12, Vitest 5, AI SDK 7, PostgreSQL 18) has rough edges | Medium     | Slower progress      | Verify each in the learning folder before adopting; pin exact versions; record workarounds in ADRs               |
| AWS cost creeps up                                                                        | Medium     | Unexpected bills     | Single instance, Budgets alerts, no NAT gateway, image lifecycle rules                                           |
| Real-time features are hard to test reliably                                              | Medium     | Flaky CI             | Deterministic sequence-based protocol; controlled network interruption in Playwright; no timing-based assertions |
| AI provider changes or fails                                                              | Medium     | Triage unavailable   | Provider-agnostic SDK, strict fallback, recorded responses for CI                                                |
