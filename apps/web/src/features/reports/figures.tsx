/** A figure of a report: a term, its value and, if any, its share. */
export function Figure({
  term,
  value,
  share: part,
}: Readonly<{ term: string; value: number; share?: string }>) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-2xl font-semibold">
        {value}
        {part === undefined ? null : (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {part}
          </span>
        )}
      </dd>
    </div>
  );
}

/** "(80%)", or nothing of zero. */
export function share(part: number, whole: number): string | undefined {
  return whole === 0
    ? undefined
    : `(${String(Math.round((part / whole) * 100))}%)`;
}
