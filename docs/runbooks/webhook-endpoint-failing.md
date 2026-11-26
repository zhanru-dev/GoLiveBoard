# Webhook endpoint failing

**When:** the alert "Webhook endpoint failing": deliveries to one endpoint failed more than 10 times in the last hour.

**How delivery works** (FR-RC-2):

- Each event an endpoint subscribes to becomes a delivery.
- The worker tries it up to 5 times: at once, then after 1, 5, 30 and 120 minutes.
- After the fifth failure it is `FAILED`, and the Owner can resend it by hand.
- Only active endpoints are sent to.
- The receiver is the customer's server. A failing endpoint is usually their problem, but it is ours to notice, tell them, and keep it from piling up work.

## Symptoms

- **Alert email** (severity `ticket`, so not a page) naming this runbook.
- **Dashboard:** "Failed webhook attempts (1 hour), by endpoint" shows which endpoint, by ID.
- **The customer:** their system did not hear about events, or saw them late.

## Checks

Operators read the database directly: they are not members of the customer's workspace, so the API's webhook routes (Owners only) are not theirs to use. Open a SQL session:

- **locally:** `docker compose -f docker-compose.prod.yml exec postgres psql -U goliveboard goliveboard`
- **in AWS** (milestone 10): `psql` on the EC2 host, through an SSM session, to the RDS endpoint in Parameter Store.

1. **Which endpoint, and whose?** Take the endpoint ID from the dashboard ("Failed webhook attempts (1 hour), by endpoint"), then:

   ```sql
   SELECT e.id, e.url, e.active, e.version, w.name AS workspace
   FROM webhook_endpoints e JOIN workspaces w ON w.id = e.workspace_id
   WHERE e.id = '<endpoint id>';
   ```

2. **What does the receiver say?** Its latest attempts:

   ```sql
   SELECT a.attempted_at, a.status_code, a.error, d.status
   FROM webhook_attempts a JOIN webhook_deliveries d ON d.id = a.delivery_id
   WHERE d.endpoint_id = '<endpoint id>'
   ORDER BY a.attempted_at DESC LIMIT 10;
   ```

   - **`status_code` 4xx:** the receiver refuses. Wrong path, method not allowed (405), or it rejects the signature (401/403: a secret not updated after "Rotate secret").
   - **`status_code` 5xx, or an `error` with no status (such as "Timed out after 10 seconds"):** the receiver is down or slow.
   - **`error` about DNS or TLS:** the domain moved or its certificate expired.

3. **Is it only this endpoint?**
   - If every endpoint fails at once, the problem is ours: the host's outbound network (the EC2 host's security group or routing in AWS), DNS, or the clock (signatures carry a timestamp).
   - Check the dashboard and the worker's logs before contacting anyone.

## Actions

**The receiver is the problem** (the usual case):

1. **Tell the workspace's Owner,** with the endpoint URL, the status codes, and when it started.
2. **If it will not be fixed soon, the Owner pauses the endpoint:** in Integrations, they switch it off. That is recorded in their audit trail (`webhook_endpoint.updated`).
   - A paused endpoint gets no new deliveries.
   - Its pending deliveries wait: they are not tried, and not given up.
3. **Only if the Owner cannot be reached and the failures harm others** (the worker's time, the alert hiding other problems), an operator pauses it in the database. The version goes up, so a page the Owner has open refuses a stale edit; this is **not** in their audit trail, so tell them, and record it in the incident:

   ```sql
   UPDATE webhook_endpoints SET active = false, version = version + 1, updated_at = now()
   WHERE id = '<endpoint id>';
   ```

4. **Once the receiver works again:**
   - The Owner switches the endpoint back on (Integrations). Pending deliveries whose time has come are sent at once.
   - Deliveries that reached `FAILED` are resent from Integrations ("Send again").
   - Receivers de-duplicate by the webhook's `id`, so resending is safe.

**We are the problem** (every endpoint failing):

- Fix the outbound network, DNS or clock.
- Pending deliveries carry on by themselves; tell the Owners of endpoints whose deliveries reached `FAILED`, so they can resend them.

## Verification

- **Dashboard:** no new failed attempts for the endpoint.
- **After resuming:** its deliveries become `SUCCEEDED`.
- **The alert** resolves once fewer than 11 failures remain in its one-hour window.
- **The Owner** confirms their system received the events.

## Rehearsals

| Date       | Where                                     | What                                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack                               | An endpoint at `https://example.com/goliveboard-hook`, which answers `405` to a POST. Sixteen cancelled events, eight a minute apart | **Alert email:** 51 s after the second batch. **Dashboard:** that endpoint, 19 failed attempts. **Deliveries:** `PENDING`, last attempt "The receiver answered 405". **Paused** by the Owner's route (`PATCH` with `If-Match`: without it `428`, stale `412`), which the runbook then gave as an operator's command although operators cannot sign in as the Owner (found by the M9 review). **After pausing:** two more cancellations and 90 s gave no new deliveries, and the attempt count stayed at 62 |
| 2026-11-19 | Local stack, the runbook's SQL as written | The same failing endpoint, twelve cancelled events                                                                                   | **Check 1:** the endpoint, its workspace, `active`, version 1. **Check 2:** attempts with `405`, "The receiver answered 405", deliveries `PENDING`. **Operator pause** (action 3): `UPDATE 1`; the Owner's edit with the old version then got `412`. **After pausing:** attempts stayed at 12 through two more cancellations and 100 s, past the 1-minute retries; Integrations shows it paused                                                                                                            |
