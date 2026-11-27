export interface MonthPoint {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly value: number;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 36 };

const monthName = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Nov 2026" for "2026-11". */
export function formatMonth(month: string): string {
  return monthName.format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * A bar per month in plain SVG, like MinuteChart: one image to assistive
 * technology, named by `label`, described by a one-line summary, with the
 * same figures under "Show the figures" as a table.
 */
export function MonthBars({
  label,
  unit,
  points,
}: Readonly<{
  label: string;
  /** What the value counts, e.g. "attendees". */
  unit: string;
  points: readonly MonthPoint[];
}>) {
  const id = `chart-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  const max = Math.max(1, ...points.map(({ value }) => value));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerWidth / Math.max(points.length, 1);
  const barWidth = Math.max(2, slot * 0.7);
  const y = (value: number) => PAD.top + innerHeight * (1 - value / max);
  const total = points.reduce((sum, { value }) => sum + value, 0);
  const busiest = points.reduce<MonthPoint | undefined>(
    (best, point) =>
      best === undefined || point.value > best.value ? point : best,
    undefined,
  );
  const first = points.at(0);
  const last = points.at(-1);
  const summary =
    busiest === undefined || total === 0
      ? `No ${unit} in these months.`
      : `${String(total)} ${unit} over ${String(points.length)} months; the most in ${formatMonth(busiest.month)}, with ${String(busiest.value)}.`;
  return (
    <figure className="grid gap-2">
      <svg
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-auto w-full"
      >
        <title id={`${id}-title`}>{label}</title>
        <desc id={`${id}-desc`}>{summary}</desc>
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-border"
        />
        <text
          x={PAD.left - 6}
          y={y(max) + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {max}
        </text>
        <text
          x={PAD.left - 6}
          y={y(0) + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          0
        </text>
        {points.map((point, index) => (
          <rect
            key={point.month}
            data-testid="month-bar"
            x={PAD.left + index * slot + (slot - barWidth) / 2}
            y={y(point.value)}
            width={barWidth}
            height={y(0) - y(point.value)}
            rx={2}
            className="fill-primary"
          />
        ))}
        {first === undefined || last === undefined ? null : (
          <>
            <text
              x={PAD.left}
              y={HEIGHT - 6}
              className="fill-muted-foreground text-[11px]"
            >
              {formatMonth(first.month)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 6}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatMonth(last.month)}
            </text>
          </>
        )}
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        {summary}
      </figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer">Show the figures</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{`${unit.charAt(0).toUpperCase()}${unit.slice(1)}`}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.month}>
                <td>{formatMonth(point.month)}</td>
                <td>{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
