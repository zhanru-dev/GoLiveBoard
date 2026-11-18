import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

const tracer = trace.getTracer("opspilot");

/**
 * Runs `work` in a span of its own, a business operation within the
 * request's or job's trace (ADR-0011). A failure marks the span with the
 * error's type only: messages can carry a recipient's details.
 */
export function inSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.name : "Error",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Adds attributes to the span this code runs in, if any. */
export function describeSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}
