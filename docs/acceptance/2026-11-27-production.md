# Production acceptance, 27 November 2026

What shipped on 27 November (#29 to #37) was checked on the live site, https://goliveboard.zhanru.dev, by hand, the way a customer would use it. The run found one production bug that no test could see; it was fixed the same night (#38).

## How

- **Where:** the shared demo workspace ("Try the demo"), so no real account or password was involved. A separate event, _Acceptance check (27 Nov)_, kept the run apart from the demo's own events. The demo resets every night.
- **Who:** staff in one tab; an attendee, _Ada_, registered through the public page and confirmed through the demo inbox, in another. Both in the desktop app's browser.
- **Reading results:** the pages themselves, the API (the same calls the pages make), the audit trail, and for the bug, the API's own log on the host (read through SSM, read-only).

## Results

| Area                        | Checked                                                                                                                                                                                                 | Result                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| How it's built (#31)        | The page renders; its links to the site and to `openapi.json` answer `200`; every file it links to on GitHub exists, and the repository is public                                                       | Pass                           |
| OpenAPI (#30, #35)          | 94 operations, polls and the overview included; the written answer and `If-Match` documented; no internal routes                                                                                        | Pass                           |
| Monthly overview (#33)      | Page and CSV (`text/csv`, named by the span); totals match each event's own report, before and after the acceptance event completed                                                                     | Pass                           |
| Polls (#34)                 | A draft reaches nobody; opened, it appears on Ada's page without a reload, with no counts until she answers; after answering, her choice marked, "Answer sent" announced, focus kept; staff counts live | Pass                           |
| Retried answers (#34)       | The same answer again: `200`, still one vote; another answer: `409 POLL_ALREADY_VOTED`                                                                                                                  | Pass                           |
| Written answers (#32)       | The answer reaches Ada's page live; reopening the question clears it live                                                                                                                               | Pass                           |
| Holding slate               | Upload, then the slate on Ada's page, served from S3                                                                                                                                                    | **Failed, then fixed** (below) |
| Going live                  | Ready, then live: Ada's page swaps the slate for the player by itself (0.25 s)                                                                                                                          | Pass                           |
| Completing (#34)            | The open poll closes with the event; Ada's page shows "1 answer · Closed" without a reload (0.9 s); the audit has `poll.closed`, "event completed", by whoever completed it                             | Pass                           |
| Report (#34)                | The report page, its API and its CSV list the poll and its counts                                                                                                                                       | Pass                           |
| Audit trail                 | Every step above, with who and what                                                                                                                                                                     | Pass                           |
| Image vulnerabilities (#29) | ECR's scan of the deployed images (`9eb4e29`): 0 findings, where the scan before #29 had 1 critical and 4 high                                                                                          | Pass                           |
| Email                       | A password reset for the owner's address: sent through SES (1 delivery attempt, no bounce, complaint or reject)                                                                                         | Pass                           |

**Not measured here:** attendance. Ada's tab shared a browser with the staff session, and when one connection carries both, staff come first (they run the event; the audience is attendees), so her heartbeats did not count. The figures themselves are covered by the integration tests.

## The bug: no AWS credentials inside the containers

**Symptom.** Uploading a holding slate answered `500`, every time, before any file was sent. Without a slate an event cannot be marked ready, so no event could go live.

**Cause.** The API's log:

```
CredentialsProviderError: Could not load credentials from any providers
  at getSignedUrl → AssetsService.createHoldingSlateUpload
```

The host required IMDSv2 with a hop limit of 1, chosen so that containers could not read the host's credentials. But S3 signing and SES both rely on exactly those credentials (ADR-0010). From Docker's bridge network a token response takes a second hop, so the SDK found none.

**Reach.** Wider than uploads:

- **Email:** SES had sent nothing in two weeks; sign-up, password reset, invitation and attendee mail had all been failing, while SES production access had just been granted.
- **The demo's nightly reset** could not upload its slates either (`DemoSeeder` logged the same error), which is why no demo event had one.

**Why no test saw it.** Every test stack signs with static keys; none takes the instance-role path.

**Fix.**

1. The live instance's hop limit set to 2 (`aws ec2 modify-instance-metadata-options`, by the owner). Uploads worked at once, without a restart.
2. #38 records it in Terraform (with its test), amends ADR-0010 with the reasoning and the tighter alternative, and adds `aws_credentials` to the API's readiness: the deploy waits for readiness, so a release that cannot obtain credentials is rolled back instead of going live, and the readiness alert fires.

## Follow-ups

- The overview groups by UTC month and date: an event at 23:00 in New York on 19 November is listed on the 20th. Whether to use each event's own time zone is a product decision, open.
- `telemetry.int.test.ts` ("stops within a few seconds") fails intermittently on CI and has not been reproduced locally.
- The Node.js base image moves to the release that bundles OpenSSL 3.5.10 (due 1 December; docs/security-review.md, "Container images").
