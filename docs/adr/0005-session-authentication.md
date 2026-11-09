# ADR-0005: Own session authentication with rotating refresh tokens

- Status: Accepted
- Date: 2026-11-09

## Context

Staff need email-and-password sign-in, immediate effect of role changes and removals, and sessions that survive across days. Attendees need a separate, lighter session after email verification. Hosted identity providers would handle much of this but add an external dependency, per-user cost and integration work, and would hide the security mechanics this project is meant to demonstrate.

## Decision

Implement authentication in the API:

- Argon2id password hashing.
- A 15-minute JWT access token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, identifying only the session.
- A 7-day random refresh token, stored as a SHA-256 hash, rotated on every use with a conditional update; presenting the previous token revokes the session (reuse detection).
- Every request reloads the session and current membership, so roles are never trusted from the token.
- Attendee sessions are separate opaque tokens with per-request eligibility checks.

## Consequences

- Full control over behaviour required by FR-AUTH and FR-AD, with each rule covered by integration tests.
- One extra database read per request (session and membership); acceptable at the target load and cacheable later if needed.
- The team owns security-sensitive code; it must follow the security checklist and be reviewed with particular care.

## Alternatives considered

- **Hosted provider (Auth0, Clerk, Cognito)**: less code, but per-user cost, vendor coupling, and role changes still need application-side checks.
- **Auth.js / Better Auth**: good libraries, but centred on the Next.js side, while authorisation must live in the NestJS API.
- **Long-lived JWTs without server state**: cannot be revoked; fails FR-WS-3 and FR-AUTH-3.
