import type { WorkspaceOverview } from "@goliveboard/contracts";

import { csvCell } from "./report-csv.js";

/**
 * The overview as CSV, in three tables separated by an empty line: the
 * totals as `metric,value`, the months, and one row per event. Cells are
 * written as in the event report's CSV (RFC 4180, formulas defused).
 */
export function overviewCsv(overview: WorkspaceOverview): string {
  const { totals } = overview;
  const figures: (string | number)[][] = [
    ["metric", "value"],
    ["from", overview.from],
    ["to", overview.to],
    ["events", totals.events],
    ["registered", totals.registered],
    ["verified", totals.verified],
    ["attended", totals.attended],
    ["peak_audience", totals.peakAudience],
    ["average_peak_audience", totals.averagePeak],
    ["questions_asked", totals.questionsAsked],
    ["questions_answered", totals.questionsAnswered],
    ["chat_messages", totals.chatMessages],
    ["incidents", totals.incidents],
  ];
  const months: (string | number)[][] = [
    ["month", "events", "registered", "attended", "questions_asked"],
    ...overview.months.map((month) => [
      month.month,
      month.events,
      month.registered,
      month.attended,
      month.questionsAsked,
    ]),
  ];
  const events: (string | number)[][] = [
    [
      "event",
      "starts_at",
      "registered",
      "verified",
      "attended",
      "peak_audience",
      "questions_asked",
      "questions_answered",
      "chat_messages",
      "incidents",
    ],
    ...overview.events.map((event) => [
      event.title,
      event.startsAt,
      event.registered,
      event.verified,
      event.attended,
      event.peakAudience,
      event.questionsAsked,
      event.questionsAnswered,
      event.chatMessages,
      event.incidents,
    ]),
  ];
  return [figures, months, events]
    .map((table) => table.map((row) => row.map(csvCell).join(",")).join("\r\n"))
    .join("\r\n\r\n")
    .concat("\r\n");
}
