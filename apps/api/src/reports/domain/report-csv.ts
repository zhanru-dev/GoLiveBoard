import type { EventReport } from "@goliveboard/contracts";

/**
 * The report as CSV (FR-RC-3), in four tables separated by an empty line:
 * the figures as `metric,value`, the audience per minute, the incidents,
 * and the closed polls' answers (a row per option). Fields are quoted as RFC 4180 asks, and a text that a
 * spreadsheet would run as a formula (it starts with =, +, -, @, a tab or a
 * carriage return) is prefixed with an apostrophe, so it is shown, not run.
 */
export function reportCsv(report: EventReport): string {
  const figures: (string | number)[][] = [
    ["metric", "value"],
    ["event", report.event.title],
    ["starts_at", report.event.startsAt],
    ["ends_at", report.event.endsAt],
    ["time_zone", report.event.timeZone],
    ["registered", report.funnel.registered],
    ["verified", report.funnel.verified],
    ["attended", report.funnel.attended],
    ["peak_audience", report.audience.peak],
    ["average_audience", report.audience.average],
    ["questions_asked", report.questions.asked],
    ["questions_answered", report.questions.answered],
    ["chat_messages", report.chat.messages],
    ["incidents", report.incidents.length],
  ];
  const minutes: (string | number)[][] = [
    ["minute", "viewers", "chat_messages", "incident_open"],
    ...report.audience.series.map((point) => [
      point.minute,
      point.viewers,
      point.messages,
      point.incident ? "yes" : "no",
    ]),
  ];
  const incidents: (string | number)[][] = [
    ["incident", "kind", "opened_at", "resolved_at"],
    ...report.incidents.map((incident) => [
      incident.id,
      incident.kind,
      incident.openedAt,
      incident.resolvedAt ?? "",
    ]),
  ];
  const polls: (string | number)[][] = [
    ["poll", "question", "option", "votes"],
    ...report.polls.flatMap((poll) =>
      poll.options.map((option) => [
        poll.id,
        poll.question,
        option.label,
        option.votes,
      ]),
    ),
  ];
  return [figures, minutes, incidents, polls]
    .map((table) => table.map((row) => row.map(csvCell).join(",")).join("\r\n"))
    .join("\r\n\r\n")
    .concat("\r\n");
}

/** One CSV field: quoted as RFC 4180 asks, a would-be formula defused. */
export function csvCell(value: string | number): string {
  if (typeof value === "number") {
    return String(value);
  }
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
