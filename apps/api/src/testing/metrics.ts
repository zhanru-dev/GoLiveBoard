import { metrics } from "@opentelemetry/api";
import {
  type DataPoint,
  MeterProvider,
  MetricReader,
} from "@opentelemetry/sdk-metrics";

/** Collects on demand: what a test reads, no exporter. */
class OnDemandReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface CapturedMetrics {
  /** The data points of one metric, as collected now. */
  points(name: string): Promise<DataPoint<unknown>[]>;
  /** Unregisters the provider again (it is process-wide). */
  stop(): Promise<void>;
}

/**
 * Records the application's metrics in memory. Call it before creating the
 * app or worker: instruments made before a provider exists stay no-ops.
 */
export function captureMetrics(): CapturedMetrics {
  const reader = new OnDemandReader();
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return {
    async points(name) {
      const { resourceMetrics } = await reader.collect();
      return resourceMetrics.scopeMetrics
        .flatMap(({ metrics: list }) => list)
        .filter(({ descriptor }) => descriptor.name === name)
        .flatMap(({ dataPoints }) => dataPoints as DataPoint<unknown>[]);
    },
    async stop() {
      metrics.disable();
      await provider.shutdown();
    },
  };
}
