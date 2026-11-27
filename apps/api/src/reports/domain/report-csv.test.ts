import type { EventReport } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import { reportCsv } from "./report-csv.js";

const report = (title: string): EventReport => ({
  event: {
    id: "0193f2a4-0000-7000-8000-000000000001",
    slug: "launch",
    title,
    status: "COMPLETED",
    startsAt: "2026-12-01T17:00:00.000Z",
    endsAt: "2026-12-01T17:02:00.000Z",
    timeZone: "Europe/London",
  },
  generatedAt: "2026-12-01T17:05:00.000Z",
  funnel: { registered: 5, verified: 4, attended: 3 },
  audience: {
    peak: 3,
    average: 2.5,
    series: [
      {
        minute: "2026-12-01T17:00:00.000Z",
        viewers: 3,
        messages: 2,
        incident: false,
      },
      {
        minute: "2026-12-01T17:01:00.000Z",
        viewers: 2,
        messages: 0,
        incident: true,
      },
    ],
  },
  incidents: [
    {
      id: "0193f2a4-0000-7000-8000-0000000000aa",
      kind: "STREAM_UNREACHABLE",
      openedAt: "2026-12-01T17:01:10.000Z",
      resolvedAt: null,
    },
  ],
  questions: { asked: 4, answered: 1 },
  chat: { messages: 2 },
  polls: [
    {
      id: "0193f2a4-0000-7000-8000-0000000000bb",
      question: "Which demo next?",
      totalVotes: 3,
      options: [
        { label: "Dashboards", votes: 2 },
        { label: "=Webhooks", votes: 1 },
      ],
    },
  ],
});

describe("reportCsv", () => {
  it("writes the figures, the minutes, the incidents and the polls as four tables", () => {
    expect(reportCsv(report("Launch")).split("\r\n")).toEqual([
      "metric,value",
      "event,Launch",
      "starts_at,2026-12-01T17:00:00.000Z",
      "ends_at,2026-12-01T17:02:00.000Z",
      "time_zone,Europe/London",
      "registered,5",
      "verified,4",
      "attended,3",
      "peak_audience,3",
      "average_audience,2.5",
      "questions_asked,4",
      "questions_answered,1",
      "chat_messages,2",
      "incidents,1",
      "",
      "minute,viewers,chat_messages,incident_open",
      "2026-12-01T17:00:00.000Z,3,2,no",
      "2026-12-01T17:01:00.000Z,2,0,yes",
      "",
      "incident,kind,opened_at,resolved_at",
      "0193f2a4-0000-7000-8000-0000000000aa,STREAM_UNREACHABLE,2026-12-01T17:01:10.000Z,",
      "",
      "poll,question,option,votes",
      "0193f2a4-0000-7000-8000-0000000000bb,Which demo next?,Dashboards,2",
      "0193f2a4-0000-7000-8000-0000000000bb,Which demo next?,'=Webhooks,1",
      "",
    ]);
  });

  it.each([
    ['=HYPERLINK("x")', '"\'=HYPERLINK(""x"")"'],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTab", "'\tTab"],
    ["\rReturn", '"\'\rReturn"'],
    ["Q&A, live", '"Q&A, live"'],
    ['Say "hi"', '"Say ""hi"""'],
    ["Line\nbreak", '"Line\nbreak"'],
    ["Plain = fine", "Plain = fine"],
  ])("writes the title %j safely", (title, written) => {
    expect(reportCsv(report(title))).toContain(`\r\nevent,${written}\r\n`);
  });
});
