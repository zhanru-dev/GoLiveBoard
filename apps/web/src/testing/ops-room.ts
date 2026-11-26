import type { LiveOps } from "@goliveboard/contracts";

/** An operations room in the middle of an event. */
export const INCIDENT = {
  id: "0195f0a0-0000-7000-8000-0000000000e1",
  kind: "STREAM_UNREACHABLE" as const,
  openedAt: "2026-12-01T17:05:00.000Z",
  resolvedAt: null,
};

export const ROOM: LiveOps = {
  event: {
    id: "0195f0a0-0000-7000-8000-0000000000e0",
    slug: "launch-ab12",
    title: "Launch",
    status: "LIVE",
    startsAt: "2026-12-01T17:00:00.000Z",
    endsAt: "2026-12-01T18:00:00.000Z",
    timeZone: "Europe/London",
  },
  stream: { ok: true, checkedAt: "2026-12-01T17:04:30.000Z", latencyMs: 80 },
  audience: {
    current: 2,
    peak: 3,
    series: [
      { minute: "2026-12-01T17:00:00.000Z", viewers: 3 },
      { minute: "2026-12-01T17:01:00.000Z", viewers: 2 },
    ],
  },
  rates: { messagesPerMinute: 4, questionsPerMinute: 1 },
  incidents: [],
  timeline: [
    {
      kind: "STATUS_CHANGED",
      at: "2026-12-01T17:00:00.000Z",
      from: "READY",
      to: "LIVE",
    },
  ],
  at: "2026-12-01T17:01:30.000Z",
};
