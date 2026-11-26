# Rotate a secret

**When:**

- a secret may have leaked (in a log, a screenshot, a commit, a laptop that is gone);
- scheduled rotation, at least once a year;
- whenever someone who knew it leaves.

## Symptoms

- gitleaks or Trivy reports a secret in CI.
- A secret was pasted somewhere it should not be.
- Access you cannot explain: sessions you did not start, webhooks signed by someone else, unusual API usage on the Anthropic or AWS bill.

## Checks

1. **Which secret?** Each needs its own steps:

   | Secret                              | Variable                                   | What it protects                                      |
   | ----------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
   | Access-token signing key            | `JWT_SECRET`                               | Every staff session (tokens live 15 minutes)          |
   | Webhook encryption key              | `WEBHOOK_ENCRYPTION_KEY`                   | Webhook signing secrets, sealed at rest (AES-256-GCM) |
   | A webhook endpoint's signing secret | (in the database)                          | One customer's webhook signatures                     |
   | Database password                   | in `DATABASE_URL`                          | All data                                              |
   | Storage keys                        | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Uploaded files                                        |
   | AI provider key                     | `ANTHROPIC_API_KEY`                        | Billing for AI triage                                 |
   | Error reporting                     | `SENTRY_DSN`                               | Only lets others send events (low)                    |

2. **Was it used?**
   - The audit trail shows sign-ins and changes by person.
   - The provider's own logs (AWS CloudTrail, Anthropic usage) show use of their keys.
   - If it was used, this is also an incident: note what was done with it.

## Actions

**How a new value reaches the API and the worker:**

- **Locally**, the stack reads `STACK_…` variables from the shell that runs `docker compose`. Export them, then recreate the two services:

  ```bash
  docker compose -f docker-compose.prod.yml up -d --wait api worker
  ```

  `docker compose restart` does **not** read changed variables; `up -d` recreates the containers with them. Keep the exports for the rest of the rotation: a `docker compose up` from a shell without them puts the stack's defaults back.

- **In AWS** (milestone 10), change the value in Parameter Store and run the deploy workflow for the commit already deployed: it renders `.env` from Parameter Store and recreates the services.

Below, "apply" means one of these two.

**`JWT_SECRET`: nobody is signed out.**

1. Generate a new key: `openssl rand -base64 48`.
2. Make the current key the previous one, and the new key current, then apply. Locally:

   ```bash
   # The current key: the stack's default unless STACK_JWT_SECRET was set.
   export STACK_JWT_SECRET_PREVIOUS="${STACK_JWT_SECRET:-stack-local-only-signing-key-not-a-secret}"
   export STACK_JWT_SECRET="$(openssl rand -base64 48)"
   ```

   Tokens signed with either key are accepted; new ones use the new key.

3. After 15 minutes (the access tokens' lifetime), blank the previous key and apply: `export STACK_JWT_SECRET_PREVIOUS=` locally.
   - A browser still holding an old token refreshes it once, without the user seeing anything (refresh tokens are not signed with this key).
4. **If the key leaked:** do step 3 at once instead of waiting. Everyone's next request refreshes. To sign everyone out, revoke all sessions as well:

   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     psql -U goliveboard goliveboard -c "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL"
   ```

**`WEBHOOK_ENCRYPTION_KEY`: receivers notice nothing.**

1. Make the current key the previous one, and a new key current, then apply. Locally:

   ```bash
   # The current key: the stack's default unless STACK_WEBHOOK_ENCRYPTION_KEY was set.
   export STACK_WEBHOOK_ENCRYPTION_KEY_PREVIOUS="${STACK_WEBHOOK_ENCRYPTION_KEY:-c3RhY2stbG9jYWwtb25seS1rZXktbm90LXNlY3JldCE=}"
   export STACK_WEBHOOK_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   ```

2. Wait for the worker to seal every signing secret again with the new key (within 10 minutes). The secrets themselves do not change:

   ```bash
   docker compose -f docker-compose.prod.yml logs --since 15m worker | grep "Webhook secrets sealed again"
   ```

   With no endpoints, there is nothing to seal and no such line.

3. Blank the previous key and apply: `export STACK_WEBHOOK_ENCRYPTION_KEY_PREVIOUS=` locally.

**A webhook endpoint's signing secret** (leaked by the customer):

- The workspace's Owner chooses "Rotate secret" on the endpoint, in Integrations.
- They update their receiver with the new secret, which is shown once.

**Database password, storage keys, AI key** (in AWS, milestone 10):

1. Create the new credential at the provider: RDS (`ALTER ROLE` or the console), the S3 IAM user, the Anthropic console.
2. Update it in Parameter Store and apply.
3. Revoke the old credential at the provider.

Locally these are fixed development values, not secrets, and are not rotated: the database password is set once, when its volume is created (`STACK_POSTGRES_PASSWORD`), and the storage keys are written in `docker-compose.prod.yml`.

**Where secrets live:**

- in AWS, Parameter Store (SecureString), read at deploy;
- locally, `.env` for development (never committed), and the stack's `STACK_…` variables.

## Verification

- `/api/v1/health/ready` is `200` after each restart.
- A session that started before the rotation still works (`GET /api/v1/me` → `200`), and a new sign-in works.
- Webhook endpoints still open (`GET /api/v1/webhook-endpoints` → `200`), and a test delivery verifies at the receiver.
- The old credential no longer works at its provider.

## Rehearsals

| Date       | Where                                                                                                                                                           | What                                                                                                                        | Result                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack, with an override file that is not in the repository                                                                                                | Both keys rotated, the previous keys blanked, then rotated back                                                             | Worked, but **not as the runbook was written then**: the committed stack passed no `*_PREVIOUS` variable to the containers, so the steps could not be followed (found by the M9 review). It also found that a blank `JWT_SECRET_PREVIOUS` stopped the API from starting; blank now means not set                  |
| 2026-11-19 | Local stack, the runbook's commands as written (after `docker-compose.prod.yml` passed `STACK_JWT_SECRET_PREVIOUS` and `STACK_WEBHOOK_ENCRYPTION_KEY_PREVIOUS`) | Both keys rotated together, the previous keys blanked at once (the leaked-key path), then back to the defaults the same way | **After rotating:** ready `200`; the session from before `200`; a new sign-in `204`, its session `200`. **Worker:** `resealed: 1` after 9.5 minutes. **Previous keys blanked:** ready `200`; the new session and its webhook endpoints `200`; the session from before `401` until its refresh (`204`), then `200` |
