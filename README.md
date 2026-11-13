# OpsPilot

OpsPilot is an operations platform for teams running high-stakes online events, such as product launches, customer conferences and company all-hands.

It answers the question operations teams struggle with most — **is this event ready to go live?** — and keeps the event under control while it runs.

## Status

In development: milestone 1 (foundations). This repository is the reference implementation that the OpsPilot build-along course follows. Start with the development documentation:

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
npm run services:up      # PostgreSQL, Valkey, Mailpit and the Caddy proxy
npm run db:deploy        # apply database migrations
npm run dev              # web app, API and contracts in watch mode
```

Open <http://localhost:3300> and create a workspace. Emails the app sends (invitations, password resets) appear in Mailpit at <http://localhost:8036>. The API answers under the same origin, for example <http://localhost:3300/api/v1/health/ready>.

| Command                 | What it does                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run check`         | Formatting, lint, types and architecture rules                                      |
| `npm test`              | Unit and component tests                                                            |
| `npm run test:int`      | API integration tests (starts its own containers)                                   |
| `npm run test:e2e`      | Playwright against production builds (needs `services:up`, `db:deploy` and `build`) |
| `npm run services:down` | Stop the local services                                                             |
