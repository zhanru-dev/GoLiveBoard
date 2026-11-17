# OpsPilot

OpsPilot is an operations platform for teams running high-stakes online events, such as product launches, customer conferences and company all-hands.

It answers the question operations teams struggle with most — **is this event ready to go live?** — and keeps the event under control while it runs.

## Status

In development. Staff can sign up, build a team, create events and prepare them in Launch Control: a runbook, the access policy, the stream (checked automatically) and the holding slate add up to a readiness score, and an event cannot become ready or go live while a hard blocker remains. Attendees register, confirm their address and watch with live chat and moderated Q&A. While the event runs, the operations room shows the stream's health, the audience and incidents as they happen; afterwards a report (also as CSV) gives the registration funnel, the audience and the interaction. Webhooks tell other systems about events and registrations, and every change is in a searchable audit trail. During busy Q&A, AI suggestions group questions that ask the same thing and propose what to answer first; nothing changes until a moderator accepts them, and Q&A carries on if the model fails. This repository is the reference implementation that the OpsPilot build-along course follows. Start with the development documentation:

| Document                                                                  | What it covers                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Documentation index](docs/README.md)                                     | How the documents fit together and the order to read them               |
| [Product requirements](docs/01-product-requirements.md)                   | Problem, users, golden flow, functional and non-functional requirements |
| [Architecture](docs/02-architecture.md)                                   | System context, components, technology choices, cross-cutting concerns  |
| [Domain and data model](docs/03-domain-and-data-model.md)                 | Modules, entities, invariants, state machines, data retention           |
| [API and contracts](docs/04-api-and-contracts.md)                         | REST conventions, endpoint catalogue, real-time protocols, webhooks     |
| [Engineering standards](docs/05-engineering-standards.md)                 | Code, testing, security, accessibility and review standards             |
| [Infrastructure and operations](docs/06-infrastructure-and-operations.md) | Local environment, CI/CD, AWS, observability, runbooks                  |
| [Delivery plan](docs/07-delivery-plan.md)                                 | Milestones, exit criteria and how they map to lessons                   |
| [Architecture decision records](docs/adr/README.md)                       | Why each significant decision was made                                  |

## Run locally

Requirements: Node.js 26 (see `.nvmrc`), npm 11, and Docker with Compose v2.

```bash
cp .env.example .env     # local settings; adjust ports here if they clash
npm ci
npm run services:up      # PostgreSQL, Valkey, Mailpit, SeaweedFS (S3) and the Caddy proxy
npm run db:deploy        # apply database migrations
npm run dev              # web app, API, worker and contracts in watch mode
```

Open <http://localhost:3300> and create a workspace. Emails the app sends (invitations, password resets) appear in Mailpit at <http://localhost:8036>. The API answers under the same origin, for example <http://localhost:3300/api/v1/health/ready>.

| Command                 | What it does                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`         | Formatting, lint, types and architecture rules                                                                                  |
| `npm test`              | Unit and component tests                                                                                                        |
| `npm run test:int`      | API integration tests (starts its own containers; needs `openssl` on the PATH)                                                  |
| `npm run test:e2e`      | Playwright against production builds (needs `services:up`, `db:deploy` and `build`)                                             |
| `npm run db:seed`       | Load the shared demo workspace, or put it back to its seed (with `DEMO_MODE=true`, "Try the demo" on the sign-in page opens it) |
| `npm run services:down` | Stop the local services                                                                                                         |

### The production build

`npm run stack:up` builds the production images and runs them with every dependency behind Caddy over HTTPS, as in production. Open <https://opspilot.localhost:3443>; the certificate comes from a local authority that your browser does not trust until you add it ([how](docs/06-infrastructure-and-operations.md#14-production-like-stack)). It runs in demo mode: **Try the demo** on the sign-in page opens a shared demo workspace with sample events, reset every night. `npm run test:e2e:stack` runs the browser tests against it, and `npm run stack:down` stops it.
