import { Inject, Injectable } from "@nestjs/common";
import type { HealthCheckResult, HealthReport } from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { HEALTH_INDICATORS, type HealthIndicator } from "./health-indicator.js";

/**
 * A dependency that does not answer within this time counts as down, so a hung
 * connection cannot make the readiness probe itself hang.
 */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type CheckOutcome =
  { readonly ok: true } | { readonly ok: false; readonly error: unknown };

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Health check timed out"));
      },
      { once: true },
    );
  });
}

/**
 * Runs one check and reports whether it succeeded within `timeoutMs`. The race
 * matters: an indicator that ignores its abort signal still cannot delay the
 * report beyond the timeout.
 */
export async function runCheck(
  indicator: HealthIndicator,
  timeoutMs: number,
): Promise<CheckOutcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    await Promise.race([indicator.check(signal), rejectWhenAborted(signal)]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(HEALTH_INDICATORS)
    private readonly indicators: readonly HealthIndicator[],
    @InjectPinoLogger(HealthService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Checks every dependency in parallel; the API is ready only if all are up. */
  async checkReadiness(): Promise<HealthReport> {
    const entries = await Promise.all(
      this.indicators.map(
        async (indicator) =>
          [indicator.name, await this.check(indicator)] as const,
      ),
    );
    const ready = entries.every(([, result]) => result.status === "up");
    return {
      status: ready ? "ok" : "unavailable",
      checks: Object.fromEntries(entries),
    };
  }

  private async check(indicator: HealthIndicator): Promise<HealthCheckResult> {
    const startedAt = performance.now();
    const outcome = await runCheck(indicator, HEALTH_CHECK_TIMEOUT_MS);
    const durationMs = Math.round(performance.now() - startedAt);
    if (outcome.ok) {
      return { status: "up", durationMs };
    }
    // The reason goes to the logs only: the endpoint is public, and error
    // messages can reveal hostnames and versions.
    this.logger.warn(
      { check: indicator.name, err: outcome.error },
      "Health check failed",
    );
    return { status: "down", durationMs };
  }
}
