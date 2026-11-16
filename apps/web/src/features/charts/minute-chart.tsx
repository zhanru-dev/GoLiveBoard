import { timeInZone } from "@/lib/time";

export interface MinutePoint {
  readonly minute: string;
  readonly value: number;
  /** Shaded: an incident was open during the minute. */
  readonly marked?: boolean;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 36 };

/**
 * A per-minute line chart in plain SVG (no chart library: the page's script
 * budget is 150 kB). It is one image to assistive technology, named by
 * `label` and described by a one-line summary, and the same figures are
 * under "Show the figures" as a table.
 */
export function MinuteChart({
  label,
  unit,
  points,
  timeZone,
}: Readonly<{
  label: string;
  /** What the value counts, e.g. "viewers". */
  unit: string;
  points: readonly MinutePoint[];
  timeZone: string;
}>) {
  const id = `chart-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  const max = Math.max(1, ...points.map(({ value }) => value));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + innerHeight * (1 - value / max);
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${String(x(index))},${String(y(point.value))}`,
    )
    .join(" ");
  const first = points.at(0);
  const last = points.at(-1);
  const peak = points.reduce<MinutePoint | undefined>(
    (best, point) =>
      best === undefined || point.value > best.value ? point : best,
    undefined,
  );
  const summary =
    first === undefined || last === undefined || peak === undefined
      ? `No ${unit} yet.`
      : `${timeInZone(first.minute, timeZone)} to ${timeInZone(last.minute, timeZone)}: peak ${String(peak.value)} ${unit} at ${timeInZone(peak.minute, timeZone)}, ${String(last.value)} in the last minute.`;
  const marked = points.flatMap((point, index) =>
    point.marked === true ? [index] : [],
  );

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
        {marked.map((index) => (
          <rect
            key={index}
            data-testid="incident-minute"
            x={x(index) - Math.max(step, 4) / 2}
            y={PAD.top}
            width={Math.max(step, 4)}
            height={innerHeight}
            className="fill-destructive/15"
          />
        ))}
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
        {first === undefined || last === undefined ? null : (
          <>
            <text
              x={PAD.left}
              y={HEIGHT - 6}
              className="fill-muted-foreground text-[11px]"
            >
              {timeInZone(first.minute, timeZone)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 6}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {timeInZone(last.minute, timeZone)}
            </text>
          </>
        )}
        {points.length === 1 ? (
          <circle
            cx={x(0)}
            cy={y(points[0]?.value ?? 0)}
            r={3}
            className="fill-primary"
          />
        ) : (
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            className="stroke-primary"
          />
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
              <th scope="col">Minute</th>
              <th scope="col">{`${unit.charAt(0).toUpperCase()}${unit.slice(1)}`}</th>
              {marked.length > 0 ? <th scope="col">Incident</th> : null}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.minute}>
                <td>{timeInZone(point.minute, timeZone)}</td>
                <td>{point.value}</td>
                {marked.length > 0 ? (
                  <td>{point.marked === true ? "Yes" : ""}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
