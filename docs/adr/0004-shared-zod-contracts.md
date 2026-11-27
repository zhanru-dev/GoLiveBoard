# ADR-0004: Shared Zod contracts as the single source of truth

- Status: Accepted (amended 2026-11-22: the public registration form, see below)
- Date: 2026-11-09

## Context

The same data shapes appear in many places: API validation, response types, web forms, real-time messages, job payloads, webhooks and API documentation. Writing them separately guarantees they drift. NestJS 12 can validate route input against any Standard Schema library, which includes Zod.

## Decision

All boundary shapes are Zod 4 schemas in `packages/contracts`, with TypeScript types inferred from them. The API validates every input with them (NestJS Standard Schema validation, and an explicit parse for real-time messages and jobs). The web app uses them for typing and, through the React Hook Form resolver, for form validation. A route registry in the same package generates the OpenAPI 3.1 document; CI fails if it is out of date.

## Consequences

- Changing a shape changes it everywhere; the compiler finds every affected caller.
- Validation rules (lengths, formats) are identical in the browser and on the server.
- The contracts package must stay free of server-only and browser-only code.
- `class-validator` and `class-transformer`, still NestJS's documented default, are not used.

## Alternatives considered

- **class-validator DTOs**: the NestJS default, but they cannot be shared with the web app and duplicate the types.
- **tRPC**: excellent type safety, but couples clients to TypeScript, gives no standard REST API for other systems and fits poorly with NestJS.
- **Generating a client from hand-written OpenAPI**: types flow one way only, and the document becomes a second source of truth to maintain.

## Amendment (2026-11-22)

Reviewed at the end of milestone 9; the decision stands, with one deliberate exception and one gap:

- **The public registration form does not use Zod in the browser.** The public event page has a script budget of 150 kB compressed (NFR-3, docs/05). Zod plus a form library would have taken a large share of it, so the form uses plain inputs with a few checks of its own (`registration-form.tsx`). The API still validates every field with the shared schema and answers with field errors, which the form shows. So the rules are the server's, and the browser's checks only save a round trip. The signed-in app keeps the resolver, as decided.
- **API documentation:** the OpenAPI 3.1 document is generated from the schemas through a route registry, and tests keep the registry in line with the controllers and the committed document in line with the registry (docs/04, section 7).
