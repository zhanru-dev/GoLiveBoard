# Learnability: a beginner finds their way in minutes

Status: agreed, November 2026; built in steps. Mockups: the Design canvas, page "Learnability". Goal (from the product owner): a first-time user gets going quickly and can discover every feature without help.

## Principles

1. **Guidance lives where the work is**, not in a tour people skip: empty states, a first-run checklist, one-line explanations on each section. A short tour is optional, never forced.
2. **Every step says why and what next.** The product already knows: readiness criteria and next actions are a checklist per event; the lifecycle says what comes after.
3. **Plain words first, terms explained once.** Holding slate, runbook, readiness, hard blocker: a short definition the first time they appear.
4. **The demo teaches by doing.** An interviewer gets a two-minute guided path through the real features.
5. Accessible as everything else: keyboard, screen readers, reduced motion; dismissible and remembered.

## What to build

1. **Getting started checklist** (Events page, new workspaces): create an event; make it ready (Launch Control); invite a teammate; open the ops room; see the public page; (Owner) connect a webhook. Ticks itself from real data; dismissible.
2. **Empty states that teach**: no events, no tasks, no attendees, no questions, nobody else in the team, no webhooks, empty audit trail: what it is, why it matters, the one action to take.
3. **Event navigation**: inside an event, tabs for Launch Control, Ops room, Report and Public page, each with a one-line description; the sidebar shows the next upcoming or live event.
4. **Lifecycle stepper** on every event: where it is (Draft → Configuring → Ready → Live → Completed) and the next step in words ("Clear 3 blockers to mark it ready").
5. **Section explainers and a glossary**: each Launch Control section opens with why it matters; terms have an accessible popover definition.
6. **Guided demo**: a panel in the demo workspace with 5 short tasks that use what the demo allows (tick a critical task and watch the score; choose who can register; register as an attendee and confirm from the demo inbox; ask a question and let AI group it; open last week's report).
7. **Help and feature map** (/help): every feature in one page, grouped by before / during / after the event, each linking to where it lives.

## Progress

- Done in the first PR: 3 (event navigation), 4 (lifecycle and next step), 5 (section explainers and glossary).
- Done in the second: 1 (getting-started checklist) and 7 (help and feature map, linked from the sidebar).

## Constraint found

The demo refuses stream URLs (stream checks fetch whatever address is entered), so a demo event can never become Ready or Live. Proposal: allow one fixed, allowlisted public test stream in the demo, so the guided path can reach Ready and Live safely. Separate decision.
