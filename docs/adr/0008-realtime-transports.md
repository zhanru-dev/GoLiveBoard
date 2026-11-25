# ADR-0008: Socket.IO for chat and Q&A, server-sent events for the operations room

- Status: Accepted (amended 2026-11-22: revocation and chat frames, see below)
- Date: 2026-11-09

## Context

Chat and Q&A are two-way: clients send messages and receive everyone else's, with no loss or duplication across reconnects. The operations room is one-way: the server pushes status, audience and incidents. Both must work through the reverse proxy, authenticate with cookies, and scale to more than one API instance.

## Decision

- **Chat and Q&A**: Socket.IO, with acknowledgements for sends, rooms per event and channel, and the Valkey adapter for multi-instance fan-out. Correctness does not rely on the transport: every change has a per-event sequence number in a database journal, clients resume from their last sequence, and sends carry a client-generated ID.
- **Operations room**: server-sent events, with `Last-Event-ID` and a fresh snapshot on reconnect.

## Consequences

- Delivery guarantees come from the database journal, so they are testable without timing assumptions.
- Two real-time mechanisms to understand, each the simplest fit for its job.
- Socket.IO adds a client library to the watch page bundle.

## Alternatives considered

- **Plain WebSockets**: smaller, but reconnection, acknowledgements, rooms and multi-instance fan-out would be rebuilt by hand.
- **Socket.IO for everything**: works, but SSE is simpler for one-way data and needs no client library.
- **Polling**: simple, but cannot meet the one-second delivery target without heavy load.
- **A hosted real-time service (Pusher, Ably)**: removes infrastructure, but adds cost and hides the mechanics this project should demonstrate.

## Amendment (2026-11-22)

Two decisions made while building it, both kept within this one:

- **Who may stay connected is decided from the database, not from Valkey.** The Valkey adapter fans out messages between instances, as decided. But a revocation (sign-out, access revoked, role or policy changed, erasure, the demo reset) is written as an `access_changes` row in the same transaction as the change. Every instance reads recent rows every second and disconnects those no longer allowed (docs/02, section 7.6). A lost pub/sub message or a Valkey outage therefore cannot stretch "within 5 seconds" (FR-AD-4); milestone 6's first review found exactly that with a fire-and-forget signal.
- **Chat goes out in frames gathered over 100 ms** (`chat.events`, an array) rather than one message per frame. The NFR-4 load test found the API's thread saturated writing one WebSocket frame per attendee per message. Gathering them made NFR-4 pass, at up to 100 ms more latency, within the 1-second objective. Sequences and catch-up are unchanged. A change to these messages keeps the previous release's form for one release (docs/04, section 4).
