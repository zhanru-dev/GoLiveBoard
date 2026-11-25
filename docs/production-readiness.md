# Production readiness: where OpsPilot meets industry practice, and where it stops

OpsPilot runs as a public demo on a budget of about **$35 a month** (ADR-0010).

This document compares each area with what a mature commercial SaaS would do. For each place where OpsPilot stops short, it explains:

- why the industry does it that way;
- why OpsPilot does not;
- what it would take to change.

The rule behind every "not done": **anything that raises the monthly cost is left out on purpose**, unless it is needed for correctness or security.

The cost figures are rough list prices for eu-west-2 at the end of 2026. Check the [AWS Pricing Calculator](https://calculator.aws/) before relying on them.

## 1. At industry level

| Area                    | What OpsPilot does                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**        | <ul><li>A modular monolith (NestJS), with module boundaries enforced by dependency-cruiser and shared contracts in `packages/contracts`.</li><li>Side effects go through a transactional outbox and BullMQ, so a message is neither lost nor sent twice.</li><li>Concurrent changes take row locks in one documented order, and each lock has a test that forces the overlap.</li><li>Decisions are recorded as ADRs.</li></ul> |
| **Code quality**        | <ul><li>TypeScript strict.</li><li>ESLint with type-aware rules, and Prettier.</li><li>CI enforces all of it.</li></ul>                                                                                                                                                                                                                                                                                                         |
| **Tests**               | <ul><li>Unit tests.</li><li>Integration tests against real PostgreSQL and Valkey (Testcontainers).</li><li>End-to-end tests on the production-like stack.</li><li>Accessibility (axe) and performance budgets (Lighthouse).</li><li>Every fix is mutation-tested: the intended test must fail without it.</li><li>Every milestone was reviewed independently before acceptance.</li></ul>                                       |
| **CI and supply chain** | <ul><li>Every commit:<ul><li>runs every test suite;</li><li>builds images for amd64 and arm64;</li><li>audits dependencies and scans for secrets (gitleaks);</li><li>checks the Terraform (fmt, validate, tests with mocks, tflint, checkov).</li></ul></li><li>Dependabot proposes only versions released at least 14 days ago.</li><li>`main` is protected: changes arrive by pull request, and CI must pass.</li></ul>       |
| **Deployment**          | <ul><li>Infrastructure as code (Terraform, tested).</li><li>GitHub reaches AWS through OIDC, with no stored keys.</li><li>Images are immutable, tagged with the commit SHA.</li><li>Migrations run before the switch.</li><li>A smoke test runs against the live site, and a failure rolls back automatically.</li></ul>                                                                                                        |
| **Health checks**       | <ul><li>Liveness (the process answers) is kept apart from readiness (PostgreSQL and Valkey answer).</li><li>Every container has a health check, and a deploy waits for all of them.</li><li>The API starts listening only once Valkey is connected, so the first requests are not refused by the limits that fail closed.</li></ul>                                                                                             |
| **Restarts**            | <ul><li>Docker restarts a process that exits.</li><li>A watchdog restarts a container that hangs:<ul><li>for the API, only when its liveness fails as well, since a restart does not fix a database that is down;</li><li>at most three times an hour;</li><li>never during a deploy.</li></ul></li><li>Docker and the watchdog start with the host.</li></ul>                                                                  |
| **Observability**       | <ul><li>OpenTelemetry traces, metrics and logs; one trace follows a click from the browser through the API to the worker.</li><li>Sentry collects errors from the browser and the server; personal data is redacted from logs.</li><li>Field data comes from real visits (Web Vitals).</li><li>Seven alerts, each with a runbook.</li></ul>                                                                                     |
| **Security**            | <ul><li>Reviewed against OWASP ASVS 5.0 level 2, and scanned with ZAP.</li><li>Rate limits, CSRF protection, a CSP with nonces.</li><li>Secrets live in Parameter Store.</li><li>The host has no SSH; it is reached through SSM only.</li></ul>                                                                                                                                                                                 |
| **Data**                | <ul><li>RDS takes daily backups, kept 7 days, with point-in-time recovery.</li><li>Deletion protection is on, and connections use TLS with a verified certificate.</li><li>Restores are rehearsed (docs/runbooks).</li></ul>                                                                                                                                                                                                    |

## 2. Where OpsPilot stops short, on purpose

| Area                      | Industry standard                                                        | Why the industry does it                                                                  | Why OpsPilot does not                                                                                                                                             | What it would take                                                                              |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **High availability**     | At least two instances across availability zones, behind a load balancer | One machine, or one zone, failing must not take the service down; the business has an SLA | One t4g.small. A demo has no SLA, and a host failure is recovered by hand (rebuild with Terraform, redeploy)                                                      | An Application Load Balancer and a second instance, or ECS on Fargate: roughly **+$40 a month** |
| **Database availability** | RDS Multi-AZ                                                             | A synchronous standby takes over in a minute or two, without losing committed data        | Single-AZ. Backups and point-in-time recovery cover data loss; the cost is downtime during an outage                                                              | `multi_az = true`: roughly **doubles the database cost (+$15)**                                 |
| **Zero-downtime deploys** | Rolling or blue-green behind a load balancer                             | Users never see a deploy                                                                  | `docker compose up` replaces the containers in place: a few seconds unavailable per deploy                                                                        | Needs the load balancer and a second instance above                                             |
| **Orchestrator**          | ECS or Kubernetes: places containers, replaces unhealthy ones, scales    | Self-healing and scaling without people                                                   | Compose on one host, plus the watchdog for hung containers. An orchestrator only pays off with several hosts                                                      | ECS on Fargate: roughly **+$30–60 a month** for these containers                                |
| **Managed Valkey**        | ElastiCache, often with a replica                                        | Failover and patching handled by the provider                                             | Valkey runs on the host. What matters is rebuilt from PostgreSQL (the outbox), and the append-only file keeps queued jobs across restarts                         | ElastiCache: roughly **+$13**, or +$26 with a replica                                           |
| **Separate environments** | Staging and production, with promotion between them                      | A release is tried on production-like data before users see it                            | One environment. CI's production-like stack (the same images, end-to-end tests) stands in for staging                                                             | A second copy of the environment: roughly **+$35**                                              |
| **Paging and on-call**    | PagerDuty or Opsgenie rotations; alerts on SLO burn rate                 | Someone is woken up, and only for what threatens the SLO                                  | Alerts go by email. There is one person and no SLA                                                                                                                | A paid paging tool, plus SLOs once there is real traffic (no cost for the SLOs themselves)      |
| **Edge protection**       | A CDN with a WAF and managed DDoS protection                             | It absorbs attacks and bad bots before they reach the application                         | Caddy, plus rate limits in the application. That is enough for abuse at demo scale, not for a determined attack                                                   | CloudFront with AWS WAF: roughly **+$10–20**                                                    |
| **Disaster recovery**     | Backups copied to a second region; a tested regional failover            | A whole region can fail                                                                   | One region. Terraform can rebuild everything, but the data would wait for the region                                                                              | Cross-region snapshot copies (a few dollars); a full failover costs far more                    |
| **Private networking**    | Application in private subnets, egress through a NAT gateway             | Nothing is reachable from the internet except the load balancer                           | The host sits in a public subnet behind a security group that opens only 80 and 443, and there is no SSH. A NAT gateway alone would cost more than the whole demo | NAT gateway: roughly **+$37 a month**, plus data                                                |

## 3. Still to do, at no extra cost

| Item                                                                                | Why                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The first deploy to AWS: the rollback drill, the external uptime check, real alerts | Nothing has run in production yet. This is M10's remaining work                             |
| SLOs and error budgets                                                              | Targets exist (the NFRs), but an SLO needs real traffic to set. Start after a month of data |
| Load test on AWS                                                                    | k6 has run locally only. One run on the real host is cheap                                  |
| Feature flags, visual regression tests                                              | In the backlog (docs/07)                                                                    |

## 4. Talking about it

The useful conversation is not "it has everything". It is:

- what each practice protects against;
- what it costs;
- why this project chose differently at this scale;
- and the order in which you would add each piece as the service grows.

That order, for OpsPilot:

1. Multi-AZ RDS, once data matters to someone.
2. A load balancer and a second instance, once an SLA does; that also brings zero-downtime deploys.
3. A staging environment, once more than one person ships.
4. A WAF and CDN, once it is a target.
5. ECS, once one host is not enough.
6. Cross-region recovery, last.
