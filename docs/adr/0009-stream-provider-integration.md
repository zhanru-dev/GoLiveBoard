# ADR-0009: Integrate with the customer's streaming provider instead of hosting video

- Status: Accepted
- Date: 2026-11-09

## Context

Event teams already use streaming providers (Mux, AWS IVS, Cloudflare Stream and others) that handle ingest, transcoding and global delivery. Running our own media server would be expensive to host, operationally heavy, and would compete with mature products. The operational problem customers have is not delivering video; it is knowing that the stream works and reacting when it fails.

## Decision

OpsPilot stores the event's HLS playback URL from the customer's provider. The watch page plays it with hls.js; video never passes through OpsPilot. A worker checks the stream manifest every 30 seconds from an hour before the start, opening and resolving incidents, and the result feeds the readiness score.

## Consequences

- No media infrastructure to host; the product focuses on preparation, control and record.
- Readiness and incident handling depend on the provider's manifest being reachable, which is the right signal for attendees too.
- Providers without an HLS playback URL (for example some embedded players) are not supported in this version.
- The stream check makes outbound requests to customer-supplied URLs, so it must use the SSRF-safe HTTP client.

## Alternatives considered

- **Own media server (RTMP ingest to HLS)**: what an earlier version did; costly, hard to operate, and not the problem customers need solved.
- **Embedding provider players by iframe only**: easier, but no reliable health signal and less control over the watch page.
