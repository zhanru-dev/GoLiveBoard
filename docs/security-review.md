# Security review: OWASP ASVS 5.0 level 2 (milestone 9)

Reviewed on 19 November 2026 against **OWASP ASVS 5.0, level 2**, for the areas in scope (NFR-1), with the security checklist of docs/05 (section 7) and a dynamic scan.

## How it was checked

| Method                                                             | What                                                                                                                                       | Result                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| **Reading the code** against each ASVS chapter in scope            | Authentication, sessions, authorisation, validation, files, cryptography, communication, configuration, data protection, logging           | Evidence per chapter below |
| **Tests already in CI**                                            | Cross-workspace and role tests for every endpoint; race tests for every lock; the SSRF client; signing; token rotation; error scrubbing    | Named per chapter below    |
| **OWASP ZAP 2.17.0**, against the production-like stack over HTTPS | Baseline (spider and passive rules) without a session and signed in (AJAX spider, which runs the pages' scripts); an active scan signed in | See "Dynamic scan"         |
| **Supply chain** in CI                                             | `npm audit` (production dependencies, reviewed allowlist), gitleaks over the whole history, Trivy on the images                            | Green on every run         |

**Out of scope:**

- **V10 OAuth and OIDC:** GoLiveBoard is not an OAuth client or server.
- **V17 WebRTC:** there is none.
- **The AWS deployment:** TLS termination at the load balancer, IAM, Parameter Store and network policy arrive in milestone 10 and are reviewed then.

## Findings

| #   | Severity            | Found                                                                                                                                                                                                                                                                                                                                       | Fixed or decided                                                                                                                                                                                                                          |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium              | **Credentials in the URL without the page's script.** Forms had no method, so a submission before the script loaded (slow network, script blocked) was a GET that put the email and password into the query string. Proxies, server logs, history and referrers keep query strings. The spider showed it: `GET /sign-in?email=…&password=…` | Every form that sends data declares `method="post"`. `e2e/security.spec.ts` submits the sign-in, sign-up, password and registration forms with JavaScript off, and asserts a POST with nothing in the URL. Added to the docs/05 checklist |
| F2  | Low                 | **No Cross-Origin-Opener-Policy or Cross-Origin-Resource-Policy** on the web app's pages; the API had both (helmet)                                                                                                                                                                                                                         | `same-origin` for both, in `next.config.ts`; asserted by `e2e/security.spec.ts`                                                                                                                                                           |
| F4  | Low                 | **TRACE answered with a 500.** The active scan's TRACE requests to pages crashed into Next.js's error path: a 500, an error report, and a 5xx for the error-rate alert to count. Nothing was reflected (no cross-site tracing)                                                                                                              | The proxy refuses TRACE, TRACK and CONNECT with 405 before any application sees them (`infra/docker/Caddyfile.prod`); asserted by `e2e/security.spec.ts`                                                                                  |
| F3  | Low (documentation) | docs/04, section 7 described a generated OpenAPI document checked in CI. It does not exist yet                                                                                                                                                                                                                                              | docs/04 now says it is planned; the scan crawled the app instead of reading it                                                                                                                                                            |
| A1  | Accepted            | **CSP `style-src 'unsafe-inline'`** (ZAP 10055)                                                                                                                                                                                                                                                                                             | `script-src` uses per-request nonces, and inline scripts are refused. Inline styles come from Next.js and Radix positioning, so a style nonce would need changes in both. The risk of injected styles (no script) is low                  |
| A2  | Accepted            | **No Cross-Origin-Embedder-Policy** (ZAP 90004)                                                                                                                                                                                                                                                                                             | `require-corp` would refuse the customer's video stream, served from their own origin without CORP. Nothing in GoLiveBoard needs cross-origin isolation                                                                                   |
| A3  | Not applicable      | **"Absence of anti-CSRF tokens"** (ZAP 10202) on the forms                                                                                                                                                                                                                                                                                  | Those forms post to their own page, which changes nothing; every change goes through the API, which refuses a state-changing request without a matching `Origin` (`auth/origin.guard.ts`). Session cookies are `SameSite=Lax`             |

## By chapter

### V1 Encoding and Sanitization; V2 Validation and Business Logic

- **Validation:**
  - Every request body, query and real-time message is parsed with its Zod schema from `packages/contracts`. Unknown fields are dropped, never passed on.
  - The global validation pipe and the gateway's own parsing do this before any handler runs.
- **Output:**
  - React escapes everything rendered, and the app never uses `dangerouslySetInnerHTML`.
  - Emails are plain text.
  - CSV exports guard against formula injection (M7).
- **SQL:** queries are parameterised (Prisma, or tagged `$queryRaw`). No string is ever concatenated into SQL.
- **Business rules hold under concurrency:**
  - check-then-act runs under the event's row lock, and caps are atomic;
  - each lock has a forced-overlap test (M5 to M8 reviews).

### V3 Web Frontend Security

- **CSP:** a nonce per request for scripts (`apps/web/src/proxy.ts`), `frame-ancestors 'none'`, and storage and the stream allowed by name.
- **Other headers:**
  - HSTS, one year with subdomains, at the proxy;
  - `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`;
  - COOP and CORP (F2).
- **Cookies:** `__Host-` (access) and `__Secure-` (refresh, path-limited to `/api/v1/auth`), all `HttpOnly`, `Secure` and `SameSite=Lax`.
- **One origin** for the app and the API (ADR-0003), so no CORS is opened.
- **Forms post** (F1).

### V4 API and Web Service

- **Origin:** state-changing requests need a matching `Origin`.
- **Errors:** problem details, with no stack traces or internal messages.
- **WebSocket:**
  - only from the app's origin;
  - authenticated at the handshake, and re-checked when access changes, within seconds (M6);
  - rate-limited per connection, author and address.
- **Rate limits:**
  - on sign-in failures per account and per address;
  - on sign-up, registrations, password resets, chat, questions, votes, triage and webhooks;
  - failing closed where a burst costs money or abuse (M4, M8).

### V5 File Handling

The holding slate is uploaded straight to object storage with a presigned PUT.

- **What may be uploaded:** the URL signs the declared `content-type` and `content-length`, at most `HOLDING_SLATE_MAX_BYTES`, an image type.
- **Checked afterwards:** the API compares the stored size and reads the file's first bytes to confirm the image type (`assets/domain/image-signature.ts`). A file that fails is deleted once its rejection has committed.
- **Upload links** last 5 minutes.
- **Served from a separate storage origin,** never from the app's.

### V6 Authentication

- **Passwords:**
  - at least 12 characters;
  - Argon2id with OWASP's parameters (19 MiB of memory, 2 iterations; `auth/password-hasher.ts`);
  - no composition rules, and pasting allowed.
- **Sign-in:** one answer for an unknown address and a wrong password, and failures limited per account and per address.
- **Account recovery:**
  - reset tokens are single-use, valid 30 minutes and stored only as hashes;
  - a reset ends every session.
- **Email verification:** before sign-in for staff, and before admission for attendees.
- **Demo:** sign-in is one click into a workspace marked as shared, and it is reset nightly.

### V7 Session Management

- **Access token:** a 15-minute JWT, HS256 with the algorithm pinned on verification, and a previous key accepted during rotation (`auth/access-token.ts`).
- **Refresh tokens:**
  - opaque and stored hashed, rotated on every use;
  - reuse after a 10-second grace (two tabs) is treated as theft and ends the session (`REFRESH_REUSE_GRACE_MS`).
- **Sign-out** ends the session on the server.
- **Ending access:** removing a member or revoking an attendee ends their real-time connections within seconds (durable access changes, M6).

### V8 Authorization

- **Every request:**
  - it is re-authorised from current membership (`SessionGuard`);
  - roles are declared per route (`@RequireRole`);
  - every query is scoped by `workspaceId`.
- **Tests:** every endpoint has a cross-workspace test and a role test (a docs/05 checklist rule, checked in each milestone review).
- **Attendees:**
  - limited to their event;
  - a revoked attendee is refused on the next request.

### V9 Self-contained Tokens

- **Access JWT:** signature and algorithm verified, expiry enforced, and no sensitive data in its claims (user, workspace, role).
- **Session revocation** (V7) ends the session at its next refresh. Removal from a workspace takes effect at once, because membership is read per request.

### V11 Cryptography

- **Webhook secrets:** sealed at rest with AES-256-GCM (`webhooks/secret-box.ts`), with re-sealing for key rotation (M7).
- **Webhook signatures:** HMAC-SHA256 over a timestamp and the body, compared in constant time (`webhooks/signing.ts`).
- **Tokens:** random from `crypto.randomBytes`, stored as SHA-256 hashes.
- No algorithm of our own, and no MD5 or SHA-1.

### V12 Secure Communication

- **To the browser:** HTTPS only (HSTS); the stack uses Caddy's local authority, and AWS will use ACM (milestone 10).
- **Outbound (webhooks, stream checks):** through the SSRF-safe client (`net/safe-http.ts`, `net/address-policy.ts`):
  - private, loopback and link-local addresses are refused at connection time, not only when the URL is accepted;
  - no redirects are followed;
  - time limits apply.

### V13 Configuration

- **Configuration** is validated at start (`config/app-config.ts`), and the process refuses to start on a bad value.
- **Secrets:**
  - from the environment (Parameter Store in AWS);
  - none in code: gitleaks over the history and Trivy's secret scan on the images.
- **Images and containers:**
  - pinned by digest;
  - non-root, read-only, every capability dropped (`docker-compose.prod.yml`).
- **Dependencies:** `npm audit` of production dependencies on every CI run, with a reviewed and expiring allowlist (M8).
- **No debug in production:** `poweredByHeader` off.

### V14 Data Protection

- **Personal data:**
  - minimal;
  - consent recorded with the notice version;
  - retention by workspace setting (90 days by default), and anonymisation and erasure jobs (M5).
- **Out of telemetry:**
  - logs redact passwords, tokens, cookies and email addresses;
  - spans carry no query strings, addresses or values (M9);
  - Sentry events are scrubbed of personal data.
- **AI triage** sends the model question text under labels only, never IDs, names or emails (M8).

### V15 Secure Coding and Architecture

- **Modules:** a modular monolith (ADR-0002) with dependency rules enforced in CI (dependency-cruiser).
- **Concurrency:** the rules in docs/05, with a forced-overlap test for every lock.
- **Reviews:** every milestone has an adversarial review with mutation testing (M3 to M8).

### V16 Security Logging and Error Handling

- **The audit trail** records every important decision, with who, what and when, for two years (FR-RC-1).
- **Logs:** structured, with request and trace IDs (M9).
- **Errors** are reported to Sentry, throttled and scrubbed.
- **Failures** are answered with problem details and a request ID, never internal detail.

## Dynamic scan

ZAP 2.17.0 (`zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af`) ran against the production-like stack, inside its network, over HTTPS. [`scripts/zap-scan.sh`](../scripts/zap-scan.sh) runs the three scans below exactly as they ran: `bash scripts/zap-scan.sh <output directory> [baseline|signed-in|active]`.

| Scan                                                           | URLs | Fail | Warnings                                                       |
| -------------------------------------------------------------- | ---- | ---- | -------------------------------------------------------------- |
| Baseline, no session (before F1/F2)                            | 32   | 0    | 6, F1 and F2 among them                                        |
| Baseline, no session (after)                                   | 29   | 0    | 6: A1, A2, A3 and three informational                          |
| Baseline, signed in, AJAX spider                               | 54   | 0    | 6: as above                                                    |
| Active scan, signed in (attacks: injection, traversal, XSS, …) | 34   | 0    | 6: A1–A3, F4 (before its fix), and two below; 137 rules passed |

**Which spider ran where.** The signed-in **baseline** ran the AJAX spider, which runs the pages' scripts, and finished (54 URLs). The **active** scan was first started with the AJAX spider too; that run's browser ran out of memory alongside the stack, so the active scan ran with the traditional spider (and two threads per host). It reached the pages and the API routes they link to; the routes only scripts call were not attacked by ZAP, and are covered by the API's own tests instead: validation, roles and cross-workspace scoping for every one.

Two warnings came from the active scan alone:

- "Proxy Disclosure" (40025): TRACE and OPTIONS reveal that a proxy exists, without its name or version. That is how GoLiveBoard is built.
- "Timestamp Disclosure" (10096): a server time in a page. Nothing secret.

The informational warnings:

- "Non-Storable Content": pages are `no-store` by design.
- "Modern Web Application".
- "Authentication Request Identified".

## Next

Milestone 10 reviews the AWS side: TLS at the load balancer, IAM least privilege, Parameter Store, security groups and the deploy pipeline's OIDC trust. The scan above is repeated against the demo environment there.
