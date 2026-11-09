# ADR-0008: Socket.IO for chat and Q&A, server-sent events for the operations room

- Status: Accepted
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
