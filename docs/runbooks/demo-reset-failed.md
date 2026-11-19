# Demo reset failed

**When:**

- the public demo workspace still shows yesterday's visitors' changes in the morning;
- the worker logged `Maintenance job failed` for `demo-reset`;
- the alert "Work waiting more than 5 minutes" fired around 03:00 UK time.

**How the reset works** (docs/06, section 10):

- With `DEMO_MODE=true`, the worker keeps a BullMQ job scheduler, `demo-reset`, on the `maintenance` queue. It fires every night at 03:00 Europe/London.
- The job runs `DemoSeeder.reset()`. It removes the demo workspace's events and files, and seeds them again from the fixed seed.
- A failed job is retried 3 times (1 s, 2 s, 4 s), then stays failed until the next night.

## Symptoms

- Visitors see others' events, messages or uploads in the demo.
- The worker's log has `"Maintenance job failed"` with `jobName: "demo-reset"`, and no `"Demo workspace reset"` that night.
- **Dashboard:** "Oldest waiting job" on `maintenance` is high when the worker is down or stuck.

## Checks

1. **Did it run?**
   - Search the worker's logs since 03:00 for `Demo workspace reset` (success) or `Maintenance job failed` (failure, with the error).
   - Locally: `docker compose -f docker-compose.prod.yml logs --since 6h worker | grep -E "Demo workspace reset|Maintenance job failed"`.
2. **Is demo mode on?**
   - The worker's `DEMO_MODE` must be `true`. With it off, the scheduler is removed on start, and nothing resets: that is by design.
3. **Is the worker running and consuming?**
   - `docker compose ... ps worker`, and the dashboard's queue panels.
   - If no worker ran at 03:00, the job waits. It runs when one starts.
4. **What failed?**
   - The error in the failure log names it. Usually the database or storage was unreachable at 03:00, so check `/api/v1/health/ready`.
   - A seed that no longer fits the schema (after a migration) fails every night: that needs a code fix.

## Actions

1. **Fix the cause first:** restore the dependency, restart the worker, or turn demo mode back on.
2. **Then reset by hand.** Do not wait for 03:00. The reset is safe to run at any time, and repeating it changes nothing.
   - Locally: `docker compose -f docker-compose.prod.yml exec worker node --enable-source-maps dist/demo/seed.js`
   - In development: `npm run db:seed`
   - In AWS (milestone 10): run the worker's task once with the command `node dist/demo/seed.js` (`aws ecs run-task` with a command override).
3. **If the seed itself is broken:** fix it in code, deploy, and run step 2.
   - Until then, close the demo to new visitors: `DEMO_MODE=false` on the web server hides "Try the demo", and on the API refuses demo sign-ins. Leave the worker's on, or its scheduler is removed. The banner promises a nightly reset, and what one visitor typed must not stay in front of the next for days.

## Verification

- The command logs `Demo workspace seeded (N events replaced)`.
- The demo workspace shows the seeded events and none of the visitors'.
- The next night's log has `Demo workspace reset`.

## Rehearsals

| Date       | Where       | What                                                                                                | Result                                                                                                                                                                                                                              |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack | Added an event to the demo workspace (a visitor's leftover). Stopped PostgreSQL, then ran the reset | **Reset:** exit code 1; the leftover still there (5 demo events). **Fix:** PostgreSQL restarted, then the reset run by hand: `Demo workspace seeded (5 events replaced)`. **After:** 4 demo events, the seed, and the leftover gone |
