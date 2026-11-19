# Deploy and roll back

**When:**

- every release;
- a smoke test that fails after a deploy;
- the alerts "API 5xx rate above 2%" or "API readiness check failing".

## Symptoms

- **Alert email:** "API readiness check failing" (no successful check for 2 minutes) or "API 5xx rate above 2%" (for 5 minutes).
- **Dashboard:** "Readiness check" drops to 0, or "Share of 5xx responses" rises.
- **Users:** pages answer 502, or a new release behaves wrongly.

## Checks

1. **Did a deploy just happen?**
   - Locally: `docker compose -f docker-compose.prod.yml ps`, which shows each service's image and status.
   - In AWS: the deploy workflow's last run.
   - A release less than an hour old is the first suspect.
2. **Is the API up?** `curl -k https://<site>/api/v1/health/ready`:
   - `200` means up;
   - `502` means the proxy cannot reach it;
   - `503` means it is up but a dependency is down (its body says which: `database` or `valkey`).
3. **What does it say?**
   - Locally: `docker compose -f docker-compose.prod.yml logs --tail 50 api`.
   - A crash loop shows the same start-up error again and again.
4. **A dependency?** If readiness says `database` or `valkey` is down, this is not the release. Restore the dependency (PostgreSQL or Valkey) first.

## Actions

**The release is bad: roll back to the previous images.** Do not try to fix forward under an alert.

Locally, images are named by `STACK_API_IMAGE` and `STACK_WEB_IMAGE`:

```bash
# Before every deploy, keep what runs now:
docker tag opspilot-api:local opspilot-api:previous
docker tag opspilot-web:local opspilot-web:previous

# Roll back:
STACK_API_IMAGE=opspilot-api:previous STACK_WEB_IMAGE=opspilot-web:previous \
  docker compose -f docker-compose.prod.yml up -d --wait api worker web
```

**Migrations:**

- They follow expand-and-contract (docs/06, section 4): each one works with both the old and the new code. Rolling back the code does not need rolling back the schema.
- If a migration itself is the problem, restore the database instead ([restore-database.md](restore-database.md)).

**In AWS** (milestone 10):

- The deploy pipeline runs the smoke test after each deploy and, when it fails, deploys the previous commit's images by itself.
- By hand, run the deploy workflow for the previous commit: it runs `deploy <previous sha>` on the EC2 host through SSM. The images are immutable, tagged with the commit SHA (docs/06, section 4).

## Verification

- `curl -k https://<site>/api/v1/health/ready` answers `200`.
- `docker compose ... ps` shows the previous images, `healthy`.
- The dashboard's readiness is back at 1 within a minute, and the alert resolves by itself.
- Run `npm run test:e2e:stack -- e2e/smoke.spec.ts`.

## Rehearsals

| Date       | Where       | What                                                              | Result                                                                                                                                                           |
| ---------- | ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-18 | Local stack | Stopped Valkey: readiness 503                                     | "API readiness check failing" fired, and its email reached Mailpit after 231 s. Valkey restarted; the alert resolved                                             |
| 2026-11-19 | Local stack | Deployed a release that fails on start (`opspilot-api:release-b`) | `ps`: `Restarting`; readiness `502`; logs: the start-up error repeated. Rolled back to `release-a`: **healthy 20 s after the rollback started**, readiness `200` |
