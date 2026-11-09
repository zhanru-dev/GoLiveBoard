# ADR-0003: Serve web and API from one origin

- Status: Accepted
- Date: 2026-11-09

## Context

The browser talks to Next.js pages, the NestJS REST API, a Socket.IO endpoint and server-sent events. Authentication uses `HttpOnly` cookies. Serving these from different origins would require CORS configuration, `SameSite=None` cookies (with weaker CSRF protection) and credentialed cross-origin WebSockets.

## Decision

A reverse proxy (Caddy) serves everything from one origin: `/api/*` and `/realtime` go to the API, all other paths go to Next.js. The same layout is used locally (Caddy in Docker Compose) and in production. Next.js Server Components call the API over the internal network, forwarding the user's cookies.

## Consequences

- No CORS. Cookies can be `SameSite=Lax`; CSRF protection reduces to an `Origin` check on state-changing requests.
- Local development matches production routing, so cookie and WebSocket problems appear early.
- The proxy becomes a required component, also in development.

## Alternatives considered

- **Separate API domain with CORS**: more configuration, weaker cookie settings, and more cross-origin edge cases with WebSockets.
- **Proxy through Next.js rewrites**: convenient for HTTP, but unreliable for WebSockets and server-sent events, and it adds load to the web server.
