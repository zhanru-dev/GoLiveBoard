/**
 * A W3C `traceparent` header that starts a trace in the browser (ADR-0011):
 * the API continues it, and so does any job the request causes. No SDK and
 * no browser spans, so the public page's script budget is untouched.
 */
export function traceparent(): string {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  // Version 00, sampled (01).
  return `00-${traceId}-${spanId}-01`;
}

/** Random bytes as hex, never all zeros (an invalid trace or span ID). */
function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  if (values.every((value) => value === 0)) {
    values[bytes - 1] = 1;
  }
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
