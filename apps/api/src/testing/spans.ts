import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";

/** Spans recorded while a test runs, kept in memory. */
export interface CapturedSpans {
  spans(): ReadableSpan[];
  /** Unregisters the provider again (it is process-wide). */
  stop(): Promise<void>;
}

/**
 * Records the spans the code under test starts through
 * `@opentelemetry/api` (business spans; libraries are instrumented only in
 * the real processes, see telemetry.int.test.ts).
 */
export function captureSpans(): CapturedSpans {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  return {
    spans: () => exporter.getFinishedSpans(),
    async stop() {
      trace.disable();
      context.disable();
      propagation.disable();
      await provider.shutdown();
    },
  };
}
