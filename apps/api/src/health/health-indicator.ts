/**
 * One dependency the API needs in order to serve requests, such as the
 * database. Platform modules provide indicators; the health module runs them.
 */
export interface HealthIndicator {
  /** Key in the readiness report, for example `database`. */
  readonly name: string;
  /**
   * Resolves when the dependency is usable and rejects otherwise. Should stop
   * work when `signal` aborts, which happens when the check times out.
   */
  check(signal: AbortSignal): Promise<void>;
}

/** Injection token for the list of indicators checked by `/health/ready`. */
export const HEALTH_INDICATORS = Symbol("HEALTH_INDICATORS");
