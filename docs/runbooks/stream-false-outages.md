# Stream check reports false outages

**When:** an incident opens ("Stream unreachable"), but the stream plays for viewers. The checker sees something the audience does not.

**How checks work** (FR-ST-2):

- The worker fetches the event's HLS manifest every 30 seconds, from 60 minutes before the start until the end (longer while the event is LIVE). A Manager can also ask for a check from Launch Control.
- Two failures in a row open an incident.
- Two successes in a row resolve it.
- **A check passes when** the manifest answers 2xx within 5 seconds and starts like an HLS playlist (`#EXTM3U`).

## Symptoms

- An incident in the operations room, and the readiness check "Stream reachable" failing on Launch Control, while viewers and the producer see the stream play.
- **Dashboard:** "Failed stream checks (15 minutes), by event".

## Checks

1. **What did the checker get?**
   - The event's stream checks: Launch Control's stream panel, or `GET /api/v1/events/<id>/stream/checks`. Each has `httpStatus`, `failure` and `latencyMs`.
2. **Fetch the same URL from where the worker runs**, not from your laptop:
   ```bash
   docker compose -f docker-compose.prod.yml exec worker \
     node -e "fetch('<manifest url>').then(async r => console.log(r.status, (await r.text()).slice(0, 80)))"
   ```
   In AWS: from a task in the worker's subnets (`aws ecs execute-command`).
3. **Match it to a cause:**

   | The checker gets                                 | Viewers get        | Usually                                                                                                                               |
   | ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
   | `403`                                            | the stream         | The CDN blocks by country or by IP range (the worker's address is a data-centre one), or the URL is signed for viewers' sessions only |
   | `404`                                            | the stream         | The URL in OpsPilot is not the one the player uses (a different rendition, an old path, or a typo)                                    |
   | timeout                                          | the stream, slowly | The origin is slow from the worker's region. Checks give up after 5 s                                                                 |
   | `200`, but "The response is not an HLS playlist" | the stream         | A page in front of the manifest: a cookie wall, a login, or a redirect to HTML                                                        |
   | the same failure                                 | nothing either     | **Not a false outage.** The stream is down: follow the incident                                                                       |

## Actions

- **Wrong URL:** set the URL the player actually uses: Launch Control, stream panel, or `PUT /api/v1/events/<id>/stream`. Use the master manifest, not a single rendition.
- **The CDN blocks the checker:** ask the stream provider to allow the worker's egress address (the NAT gateway's Elastic IP in AWS), or to allow the manifest without a viewer token. Do not loosen anything for viewers.
- **Slow origin:** usually a provider issue. If it lasts, raise it with them; the 5-second budget stays (NFR-3).
- **Until it is fixed:**
  - The incident stays open, and that is correct: checks resolve it, nobody does by hand.
  - Tell the people running the event (the producer and the moderators, not the audience's chat) that the stream plays and why the checker fails, so nobody acts on the incident.

## Verification

- The next two checks pass (`httpStatus` 200, no `failure`). Ask for one at once from Launch Control instead of waiting 30 seconds.
- The incident shows as resolved.
- "Stream reachable" is green on Launch Control.

## Rehearsals

| Date       | Where       | What                                                                                                                | Result                                                                                                                                                                                                                                                                                                              |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | Local stack | Set the stream to a URL that does not exist (`https://example.com/opspilot-drill/live.m3u8`), then asked for checks | **Incident:** opened after two failed checks, `HTTP 404`. **From the worker's network:** the same `404` and an HTML page, so the URL was at fault. **Fix:** set the stream to a URL that plays (Apple's public HLS example). **After:** two checks passed (`200`), and the incident was resolved 17 s after the fix |
