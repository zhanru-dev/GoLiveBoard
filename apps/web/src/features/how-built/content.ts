/**
 * The "How it's built" page (/how-its-built): the engineering behind the
 * product, for the people who evaluate it. Every claim names the document in
 * the repository that backs it; content.test.ts fails if one goes missing.
 */

export const REPOSITORY = "https://github.com/zhanru-dev/GoLiveBoard";

/** A path in the repository, from its root. */
export type RepositoryPath =
  "README.md" | `${"docs" | "infra" | "scripts" | ".github"}/${string}`;

export function onGitHub(path: RepositoryPath): string {
  return `${REPOSITORY}/blob/main/${path}`;
}

export interface Figure {
  readonly value: string;
  readonly label: string;
  readonly source: RepositoryPath;
}

export const FIGURES: readonly Figure[] = [
  {
    value: "900+",
    label: "unit and component tests, 90% coverage required on domain code",
    source: "README.md",
  },
  {
    value: "560+",
    label: "integration tests against real PostgreSQL, Valkey and S3",
    source: "README.md",
  },
  {
    value: "0.57 s",
    label: "chat delivery at p95 to 500 attendees (load test, local stack)",
    source: "docs/load-tests/2026-11-18-nfr4-local.md",
  },
  {
    value: "1.00",
    label: "Lighthouse accessibility score on the public event page",
    source: "docs/lighthouse.md",
  },
];

export interface PathStep {
  readonly name: string;
  readonly detail: string;
}

/** What a visitor's request passes through. */
export const REQUEST_PATH: readonly PathStep[] = [
  { name: "Browser", detail: "Staff and attendees" },
  { name: "Caddy", detail: "HTTPS, one origin" },
  { name: "web · api · worker", detail: "Next.js, NestJS; Valkey beside" },
  { name: "PostgreSQL", detail: "RDS, private subnets, TLS" },
];

/** What a commit passes through on its way to the same host. */
export const RELEASE_PATH: readonly PathStep[] = [
  { name: "GitHub Actions", detail: "CI green on main" },
  { name: "Deploy role", detail: "OIDC, no stored keys" },
  { name: "ECR", detail: "Images tagged with the commit" },
  { name: "SSM on the host", detail: "Migrate, deploy, smoke test" },
];

export interface Decision {
  readonly title: string;
  readonly why: string;
  readonly cost: string;
  readonly record: RepositoryPath;
}

export const DECISIONS: readonly Decision[] = [
  {
    title: "A modular monolith, not services",
    why: "One build and one deploy; ordinary transactions across modules, whose boundaries CI enforces.",
    cost: "The API and the worker scale together until a split is needed.",
    record: "docs/adr/0002-modular-monolith.md",
  },
  {
    title: "The database enforces every race that matters",
    why: "Row locks, version columns and conditional updates hold however many instances run; a test forces each overlap.",
    cost: "A few queries are raw SQL, kept in named, tested files.",
    record: "docs/adr/0006-postgres-prisma-concurrency.md",
  },
  {
    title: "Side effects leave through an outbox",
    why: "A webhook or an email goes out if and only if the change committed; every job is safe to run twice.",
    cost: "Up to a second between the change and its effect.",
    record: "docs/adr/0007-transactional-outbox.md",
  },
  {
    title: "Chat guarantees come from a journal, not the socket",
    why: "Every message has a sequence number in the database, so a reconnecting client loses nothing and sees nothing twice.",
    cost: "Two real-time mechanisms: Socket.IO for chat, server-sent events for the operations room.",
    record: "docs/adr/0008-realtime-transports.md",
  },
  {
    title: "Video stays with the customer's provider",
    why: "GoLiveBoard checks the stream and runs the room; hosting and transcoding video would be the largest cost and risk.",
    cost: "Providers without an HLS playback address are not supported.",
    record: "docs/adr/0009-stream-provider-integration.md",
  },
  {
    title: "The model sees labels, never IDs",
    why: "AI triage names questions q1…qN, so an invented label fails validation; nothing changes until a moderator confirms.",
    cost: "One broken suggestion discards the whole set.",
    record: "docs/adr/0012-ai-question-triage.md",
  },
  {
    title: "One host, not containers on ECS behind a load balancer",
    why: "It fits the demo's budget, and the containers are already production-shaped, so moving is an infrastructure change.",
    cost: "A single point of failure, and 10 to 20 seconds unavailable per deploy.",
    record: "docs/adr/0010-aws-deployment.md",
  },
];

export const RELEASE_STEPS: readonly string[] = [
  "Every pull request: format, lint, types and architecture rules; unit, integration and browser tests against the production images on amd64 and arm64; dependency, secret and image scans.",
  "A merge to main: once CI passes, the deploy workflow assumes an AWS role through OIDC and pushes arm64 images tagged with the commit.",
  "On the host, through SSM: run the new release's migrations (expand-and-contract, so the running release keeps working), start it, and wait until it is ready.",
  "Six smoke tests run against the public URL. If any fails, the previous commit is deployed again and the run fails, so the site stays up.",
];

export const ARCHITECTURE_DOC: RepositoryPath = "docs/02-architecture.md";
export const ROLLBACK_RUNBOOK: RepositoryPath =
  "docs/runbooks/deploy-and-roll-back.md";

export const ROLLBACK_DRILL =
  "Drilled on 27 November 2026: an older commit went out with a smoke test made to fail, and the pipeline put the current release back by itself, with about 30 seconds of downtime.";

export interface Evidence {
  readonly title: string;
  readonly detail: string;
  readonly path: RepositoryPath;
}

export const EVIDENCE: readonly Evidence[] = [
  {
    title: "Engineering standards",
    detail:
      "Every fix lands with a regression test, checked by a mutation that must make it fail.",
    path: "docs/05-engineering-standards.md",
  },
  {
    title: "Security review",
    detail:
      "OWASP ASVS 5.0 level 2, with ZAP scans; SSRF protection on every outbound call.",
    path: "docs/security-review.md",
  },
  {
    title: "Accessibility audit",
    detail:
      "WCAG 2.2 AA, criterion by criterion; a keyboard-only walkthrough and 320-pixel reflow in CI.",
    path: "docs/accessibility-audit.md",
  },
  {
    title: "Load test",
    detail: "500 attendees and 20 chat messages a second on one API instance.",
    path: "docs/load-tests/2026-11-18-nfr4-local.md",
  },
  {
    title: "Runbooks",
    detail:
      "Roll back, restore the database, rotate a secret, handle a cost emergency, and more.",
    path: "docs/runbooks/README.md",
  },
  {
    title: "Production readiness",
    detail:
      "Every area against industry practice: what is there, what stops short and why.",
    path: "docs/production-readiness.md",
  },
];

export const LIMITS: readonly string[] = [
  "One host: a failure takes the application down until it is replaced, and each deploy has 10 to 20 seconds without service.",
  "The database restore and the load test have been rehearsed on a laptop, not yet against AWS.",
  "Built with AI assistance (Claude), as the commits say: every milestone was reviewed independently, and every fix carries a mutation-checked test.",
];
