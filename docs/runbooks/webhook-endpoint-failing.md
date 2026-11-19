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

1. **Which endpoint, and whose?** Take the endpoint ID from the dashboard, then find its workspace and URL:
   ```sql
   SELECT e.id, e.url, e.active, w.name
   FROM webhook_endpoints e JOIN workspaces w ON w.id = e.workspace_id
   WHERE e.id = '<endpoint id>';
   ```
2. **What does the receiver say?**
   - Its deliveries hold every attempt: `GET /api/v1/webhook-deliveries?endpointId=<id>` (as an Owner of that workspace), or the deliveries in Integrations.
   - **`statusCode` 4xx:** the receiver refuses. Wrong path, method not allowed (405), or it rejects the signature (401/403: a secret not updated after "Rotate secret").
   - **`statusCode` 5xx, or an `error` with no status (such as "Timed out after 10 seconds"):** the receiver is down or slow.
   - **`error` about DNS or TLS:** the domain moved or its certificate expired.
3. **Is it only this endpoint?**
   - If every endpoint fails at once, the problem is ours: the host's outbound network (the EC2 host's security group or routing in AWS), DNS, or the clock (signatures carry a timestamp).
   - Check the dashboard and the worker's logs before contacting anyone.

## Actions

**The receiver is the problem** (the usual case):

1. **Tell the workspace's Owner,** with the endpoint URL, the status codes, and when it started.
2. **If it will not be fixed soon, pause the endpoint:** in Integrations, switch it off, or via the API:
   ```bash
   # the endpoint's current version, from GET /api/v1/webhook-endpoints
   curl -X PATCH https://<site>/api/v1/webhook-endpoints/<id> \
     -H 'If-Match: "<version>"' -H 'Content-Type: application/json' \
     -d '{"active": false}'
   ```
   - A paused endpoint gets no new deliveries.
   - Its pending deliveries wait: they are not tried, and not given up.
   - Pausing is the Owner's decision as much as ours. Agree it with them when you can.
3. **Once the receiver works again:**
   - Switch the endpoint back on. Pending deliveries whose time has come are sent at once.
   - Deliveries that reached `FAILED` are resent from Integrations ("Send again"), or with `POST /api/v1/webhook-deliveries/<id>/redeliver`.
   - Receivers de-duplicate by the webhook's `id`, so resending is safe.

**We are the problem** (every endpoint failing):

- Fix the egress, DNS or clock.
- Pending deliveries carry on by themselves; resend any that reached `FAILED`.

## Verification

- **Dashboard:** no new failed attempts for the endpoint.
- **After resuming:** its deliveries become `SUCCEEDED`.
- **The alert** resolves once fewer than 11 failures remain in its one-hour window.
- **The Owner** confirms their system received the events.

## Rehearsals

| Date       | Where       | What                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack | An endpoint at `https://example.com/opspilot-hook`, which answers `405` to a POST. Sixteen cancelled events, eight a minute apart | **Alert email:** 51 s after the second batch. **Dashboard:** that endpoint, 19 failed attempts. **Deliveries:** `PENDING`, last attempt "The receiver answered 405". **Paused** with `If-Match` (without it: `428`; with a stale version: `412`). **After pausing:** two more cancellations and 90 s gave no new deliveries, and the attempt count stayed at 62 |
