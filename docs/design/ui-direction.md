# UI direction: "control room"

Status: agreed direction, November 2026. Mockups: the Design canvas "GoLiveBoard UI direction" (claude.ai artifact GVeFRrsrA38JM9qr1wiemj). This page is the source of truth when the canvas and the code disagree.

## Principles

1. **Keep the stack.** shadcn/ui on Radix, Tailwind 4, Geist and Geist Mono (self-hosted by `next/font`). The change is a theme and layouts, not a new component library. `tokens.test.ts` keeps checking WCAG AA contrast.
2. **Every number shown must be one the product could really produce.** Marketing previews follow the readiness rules in docs/03 exactly. An interviewer will open the demo and compare.
3. **Colour has one job each.** Signal blue for actions; green, amber and red for status only; broadcast red only while an event is LIVE.
4. **Motion is small and optional.** Transitions under 300 ms; nothing moves under `prefers-reduced-motion: reduce`.

## Tokens

| Role              | Value                                                                                     | Notes                          |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Primary (actions) | `#2447D6`, hover `#1A36A8`                                                                | White text on it passes AA     |
| Text              | `#0F172A`                                                                                 | Headings tracking `-0.03em`    |
| Body text         | `#475569`                                                                                 |                                |
| Secondary text    | `#64748B`                                                                                 | Lightest grey allowed for text |
| Canvas / card     | `#F8FAFC` / `#FFFFFF`                                                                     | Border `#E2E8F0`               |
| Ready / passed    | text `#166534` on `#DCFCE7`                                                               |                                |
| At risk / partial | text `#92400E` on `#FEF3C7`                                                               |                                |
| Blocking          | text `#991B1B` on `#FEE2E2`                                                               |                                |
| LIVE              | `#E11D48`, white text                                                                     | Only for a live event          |
| Ops room (dark)   | ground `#0A0F1C`, panels `#111827`, border `#1F2A44`, text `#E2E8F0`, secondary `#94A3B8` |                                |

Figures (scores, counts, timestamps, durations, step numbers) use Geist Mono with `tabular-nums`.

## Readiness numbers for previews (docs/03, rule version 1)

| Criterion                   | Max | Scoring                               | Hard blocker           |
| --------------------------- | --- | ------------------------------------- | ---------------------- |
| Access policy configured    | 20  | all or nothing                        | missing                |
| Stream reachable (≤ 5 min)  | 25  | all or nothing                        | failing, never checked |
| Critical runbook tasks done | 25  | all or nothing                        | any critical task open |
| Holding slate uploaded      | 10  | all or nothing                        | missing                |
| All runbook tasks done      | 10  | proportional, rounded down; empty = 0 | —                      |
| Owner and description       | 10  | 5 each                                | —                      |

The landing-page example, "Autumn product launch": 12 tasks, 9 done, one critical task open. Score **72** (20 + 25 + 0 + 10 + 7 + 10), 1 blocker. Ticking the critical task: 10 of 12 done, score **98** (25 + 8 more), no blocker, "Mark as ready" enabled. It stops at 98, not 100: that is the rule.

Facts not to get wrong:

- The holding slate is shown **before** the event is LIVE (FR-RN-1). There is no automatic failover to it during an outage.
- An outage opens a `STREAM_UNREACHABLE` incident; the ops room shows it within 60 seconds.
- Stream checks run every 30 seconds.
- Access modes: Public, email domain, invite only. Attendees verify their email.
- Webhooks are signed: `v1` = hex HMAC-SHA256 of `"<t>.<raw body>"`.
- Event lifecycle: Draft → Configuring → Ready → Live → Completed (also Archived, Cancelled).

## Pages

- **Landing**: header 64 px with Product, How it works, Docs, Architecture (GitHub docs/ADRs); hero with an interactive Launch Control card (above); lifecycle bar that moves to Ready with the card; bento grid of six features, each with a small, true UI preview; closing card for the demo; multi-column footer. A status light only if wired to `/health/ready`.
- **App shell**: left sidebar (workspace switcher, Events, Team, Integrations, Audit trail, Settings, the user), stacks on phones.
- **Launch Control**: score and blocker summary, criteria with their basis and points, "Fix" links to the section; stream and critical tasks beside.
- **Ops room**: dark; LIVE badge and elapsed time; tiles for stream, watching now, chat, questions; player; viewers per minute; AI-triaged questions; incident timeline.
- **Sign-up**: split layout, invite code first when required, "Try the demo" link.

## Rejected

- Switching to Inter: Geist is already in place.
- Invented weights or scores that reach 100 by magic.
- Heavy effects (dot-grid backgrounds, glow), and any status indicator not backed by a real check.
