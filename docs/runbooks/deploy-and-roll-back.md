# Deploy and roll back

**When:**

- every release;
- a smoke test that fails after a deploy;
- the alerts "API 5xx rate above 2%", "API readiness check failing", "Worker not reporting", "Work waiting more than 5 minutes", "Chat connections failing in browsers" or "Public page slow for real visitors".

## Symptoms

- **Alert email:** "API readiness check failing" (no successful check for 2 minutes) or "API 5xx rate above 2%" (for 5 minutes).
- **Alert email about the worker:** "Worker not reporting" (no metrics from it for over 5 minutes: down, crash-looping, or cut off from the database) or "Work waiting more than 5 minutes" (it runs, but a job or an outbox message has waited that long: stuck or overloaded).
- **Dashboard:** "Readiness check" drops to 0, or "Share of 5xx responses" rises.
- **Users:** pages answer 502, or a new release behaves wrongly.

- **Alert email from browsers:** "Chat connections failing in browsers" (they could not connect to the real-time endpoint, or lost it: a proxy, WebSockets blocked, an instance gone) or "Public page slow for real visitors" (the public event page's LCP above 2.5 s at p75). After a release, both point at it first.

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
5. **The worker?** For the worker's alerts:
   - `docker compose -f docker-compose.prod.yml ps worker` and `logs --tail 50 worker`: stopped, restarting, or erroring.
   - Stopped with no error (a host restart, a manual stop): start it, `docker compose -f docker-compose.prod.yml up -d --wait worker`. What it missed is in the outbox and the queues, and runs when it is back.
   - Crash-looping after a deploy: roll back, as below.
   - Running but work waits: its logs show what it is stuck on. A job that never finishes holds its queue; restarting the worker hands the job to the next try.

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

- The deploy workflow (`.github/workflows/deploy.yml`) runs the smoke tests after each deploy. When they fail, or the release never becomes healthy or ready, it deploys the previous release again by itself and the run goes red (docs/06, section 4).
- **By hand:** in GitHub, **Actions → Deploy → Run workflow**, with **sha** set to the commit to go back to. Its images are already in ECR (immutable tags, the last 20 kept), so nothing is rebuilt; the host runs `ACTION=deploy SHA=<sha>` through SSM.
- **Without GitHub:** run the same command on the host directly:

  ```bash
  aws ssm send-command --instance-ids <host_instance_id> --document-name opspilot-demo-deploy \
    --parameters Action=deploy,Sha=<full sha>
  ```

- **Which release is running:** use `Action=current`, or `readlink /opt/opspilot/current` in an SSM session.

## Verification

- `curl -k https://<site>/api/v1/health/ready` answers `200`.
- `docker compose ... ps` shows the previous images, `healthy`.
- The dashboard's readiness is back at 1 within a minute, and the alert resolves by itself.
- Run `npm run test:e2e:stack -- e2e/smoke.spec.ts`.

## Rehearsals

| Date       | Where       | What                                                                             | Result                                                                                                                                                                                                                                   |
| ---------- | ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-18 | Local stack | Stopped Valkey: readiness 503                                                    | "API readiness check failing" fired, and its email reached Mailpit after 231 s. Valkey restarted; the alert resolved                                                                                                                     |
| 2026-11-19 | Local stack | Deployed a release that fails on start (`opspilot-api:release-b`)                | `ps`: `Restarting`; readiness `502`; logs: the start-up error repeated. Rolled back to `release-a`: **healthy 20 s after the rollback started**, readiness `200`                                                                         |
| 2026-11-19 | Local stack | Stopped the worker, with nothing queued (the case the M9 review found unalerted) | "Worker not reporting": pending 5 min 20 s after the stop, firing a minute later, **email after 425 s**. "Work waiting more than 5 minutes" stayed quiet, as designed. Worker started (`up -d --wait worker`): resolved about 40 s later |
