import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";

/** A trace's W3C headers (`traceparent`, `tracestate`), as stored. */
export type TraceCarrier = Readonly<Record<string, string>>;

/**
 * The trace this code runs in, as headers to store with work done later
 * (an outbox message, ADR-0011). Null when nothing is being traced.
 */
export function currentTraceCarrier(): TraceCarrier | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent === undefined ? null : carrier;
}

/** Whether a stored value is a carrier this process wrote. */
function isCarrier(value: unknown): value is TraceCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/**
 * Runs `work` in the trace a carrier names, so what it does joins that
 * trace. Without a carrier it runs in no trace at all, not in whatever
 * happens to be active.
 */
export function inTraceOf<T>(carrier: unknown, work: () => T): T {
  const parent = isCarrier(carrier)
    ? propagation.extract(ROOT_CONTEXT, carrier)
    : ROOT_CONTEXT;
  return context.with(parent, work);
}
