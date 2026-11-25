# ADR-0005: Own session authentication with rotating refresh tokens

- Status: Accepted
- Date: 2026-11-09

## Context

Staff need email-and-password sign-in, immediate effect of role changes and removals, and sessions that survive across days. Attendees need a separate, lighter session after email verification. Hosted identity providers would handle much of this but add an external dependency, per-user cost and integration work, and would hide the security mechanics this project is meant to demonstrate.

## Decision

Implement authentication in the API:

- Argon2id password hashing.
- A 15-minute JWT access token (HS256, current and previous signing key accepted during a rotation) in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie named `__Host-opspilot_access`, identifying only the session. The `__Host-` prefix makes browsers refuse a version of the cookie set by a subdomain.
- A 7-day random refresh token in a `__Secure-opspilot_refresh` cookie sent only to `/api/v1/auth`, stored as a SHA-256 hash, rotated on every use with a conditional update so that of two concurrent refreshes exactly one succeeds. Presenting the previous token revokes the session (reuse detection), except within 10 seconds of the rotation: a browser that refreshes from two tabs at once presents the old token a moment after the other request rotated it, and treating that as theft would sign real users out. Within the window the API answers `204` without any `Set-Cookie`, so the late response cannot overwrite or clear the cookies the winning response set; it issues nothing new either. The web app also takes a Web Lock while refreshing, so tabs take turns and the overlap is rare.
- State-changing requests must carry the app's `Origin`; together with `SameSite=Lax` this blocks cross-site request forgery.
- Every request reloads the session and current membership, so roles are never trusted from the token.
- A sign-in creates its session only if the password hash it verified is still the stored one, reading it `FOR SHARE`; a password reset updates the user row and then revokes the sessions in one transaction, so a sign-in racing a reset can never leave a session behind.
- The client may name the workspace it is showing in an `X-Workspace-Id` header; if the session has switched to another workspace, the request fails with `409 WORKSPACE_CHANGED` instead of answering with the other workspace's data.
- Attendee sessions are separate opaque tokens with per-request eligibility checks.

## Consequences

- A stolen refresh token used within 10 seconds of the legitimate rotation is not detected, but it yields no new tokens.

- Full control over behaviour required by FR-AUTH and FR-AD, with each rule covered by integration tests.
- One extra database read per request (session and membership); acceptable at the target load and cacheable later if needed.
- The team owns security-sensitive code; it must follow the security checklist and be reviewed with particular care.

## Alternatives considered

- **Hosted provider (Auth0, Clerk, Cognito)**: less code, but per-user cost, vendor coupling, and role changes still need application-side checks.
- **Auth.js / Better Auth**: good libraries, but centred on the Next.js side, while authorisation must live in the NestJS API.
- **Long-lived JWTs without server state**: cannot be revoked; fails FR-WS-3 and FR-AUTH-3.
