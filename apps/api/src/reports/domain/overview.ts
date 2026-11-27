import type { OverviewEvent, WorkspaceOverview } from "@goliveboard/contracts";

const DAY_MS = 86_400_000;

/** Days `from` to `to`, both included, as `YYYY-MM-DD` in UTC. */
export interface Span {
  readonly from: string;
  readonly to: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The span asked for, or the last twelve calendar months, this one included. */
export function overviewSpan(
  query: { readonly from?: string; readonly to?: string },
  now: Date,
): Span {
  if (query.from !== undefined && query.to !== undefined) {
    return { from: query.from, to: query.to };
  }
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
  );
  return { from: isoDate(from), to: isoDate(now) };
}

/** The span as instants: from the first day's start to the day after the last. */
export function spanBounds(span: Span): { start: Date; end: Date } {
  const start = new Date(`${span.from}T00:00:00.000Z`);
  const end = new Date(Date.parse(`${span.to}T00:00:00.000Z`) + DAY_MS);
  return { start, end };
}

/** Every calendar month the span touches, as `YYYY-MM`, oldest first. */
export function monthsOf(span: Span): string[] {
  const months: string[] = [];
  const [fromYear, fromMonth] = span.from.split("-").map(Number);
  const last = span.to.slice(0, 7);
  for (
    let cursor = new Date(Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, 1));
    ;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month >= last) return months;
  }
}

/** Totals and months from the span's events, most recent first. */
export function summariseOverview(
  span: Span,
  events: readonly OverviewEvent[],
): WorkspaceOverview {
  const sum = (pick: (event: OverviewEvent) => number) =>
    events.reduce((total, event) => total + pick(event), 0);
  const peaks = events.map((event) => event.peakAudience);
  const averagePeak =
    peaks.length === 0
      ? 0
      : Math.round((sum((event) => event.peakAudience) / peaks.length) * 10) /
        10;
  return {
    from: span.from,
    to: span.to,
    totals: {
      events: events.length,
      registered: sum((event) => event.registered),
      verified: sum((event) => event.verified),
      attended: sum((event) => event.attended),
      questionsAsked: sum((event) => event.questionsAsked),
      questionsAnswered: sum((event) => event.questionsAnswered),
      chatMessages: sum((event) => event.chatMessages),
      incidents: sum((event) => event.incidents),
      peakAudience: Math.max(0, ...peaks),
      averagePeak,
    },
    months: monthsOf(span).map((month) => {
      const inMonth = events.filter(
        (event) => event.startsAt.slice(0, 7) === month,
      );
      const total = (pick: (event: OverviewEvent) => number) =>
        inMonth.reduce((count, event) => count + pick(event), 0);
      return {
        month,
        events: inMonth.length,
        registered: total((event) => event.registered),
        attended: total((event) => event.attended),
        questionsAsked: total((event) => event.questionsAsked),
      };
    }),
    events: [...events].sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}
