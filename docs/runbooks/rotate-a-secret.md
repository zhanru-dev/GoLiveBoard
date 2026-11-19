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

**`JWT_SECRET`: nobody is signed out.**

1. Generate a new key: `openssl rand -base64 48`.
2. Set `JWT_SECRET_PREVIOUS` to the current key, and `JWT_SECRET` to the new one. Restart the API and the worker.
   - Tokens signed with either key are accepted; new ones use the new key.
3. After 15 minutes (the access tokens' lifetime), blank `JWT_SECRET_PREVIOUS` and restart.
   - A browser still holding an old token refreshes it once, without the user seeing anything (refresh tokens are not signed with this key).
4. **If the key leaked:** do step 3 at once instead of waiting. Everyone's next request refreshes. To sign everyone out, revoke all sessions as well (`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`).

**`WEBHOOK_ENCRYPTION_KEY`: receivers notice nothing.**

1. Generate a new key: `openssl rand -base64 32`.
2. Set `WEBHOOK_ENCRYPTION_KEY_PREVIOUS` to the current key, and `WEBHOOK_ENCRYPTION_KEY` to the new one. Restart the API and the worker.
3. Wait for the worker's log line `Webhook secrets sealed again` (it seals within 10 minutes). The signing secrets themselves do not change.
4. Blank `WEBHOOK_ENCRYPTION_KEY_PREVIOUS` and restart.

**A webhook endpoint's signing secret** (leaked by the customer):

- In Integrations, "Rotate secret" on the endpoint.
- Its owner updates the receiver with the new secret shown once.

**Database password, storage keys, AI key:**

1. Create the new credential at the provider (RDS, the S3 IAM user, Anthropic console).
2. Update it in Parameter Store and redeploy (milestone 10). Locally, the `STACK_…` variables and `npm run stack:up`.
3. Revoke the old credential at the provider.

**Where secrets live:**

- in AWS, Parameter Store (SecureString), read at deploy;
- locally, `.env` (never committed) or the stack's `STACK_…` variables.

## Verification

- `/api/v1/health/ready` is `200` after each restart.
- A session that started before the rotation still works (`GET /api/v1/me` → `200`), and a new sign-in works.
- Webhook endpoints still open (`GET /api/v1/webhook-endpoints` → `200`), and a test delivery verifies at the receiver.
- The old credential no longer works at its provider.

## Rehearsals

| Date       | Where       | What                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack | Both keys rotated (`JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY`), the previous keys blanked, then rotated back the same way | **After rotating:** the session from before still `200`, new sign-in `204`. **Worker:** `resealed: 1` within 6 minutes. **Previous keys blanked:** sessions and endpoints `200`. **A token signed with a dropped key:** `401`, which the browser refreshes. **Found:** a blanked `JWT_SECRET_PREVIOUS` stopped the API from starting ("too short"). Fixed: an empty value means not set, as for the other optional settings |
