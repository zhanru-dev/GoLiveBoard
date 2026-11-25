import { z } from "zod";

/** Body of `GET /health/live`: the process is running and can answer HTTP. */
export const LivenessReport = z.object({
  status: z.literal("ok"),
});
export type LivenessReport = z.infer<typeof LivenessReport>;

/** The outcome of checking one dependency, such as the database. */
export const HealthCheckResult = z.object({
  status: z.enum(["up", "down"]),
  /** How long the check took, rounded to whole milliseconds. */
  durationMs: z.int().nonnegative(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResult>;

/**
 * Body of `GET /health/ready`, sent with `200` when every dependency is up and
 * `503` otherwise. Health responses are read by load balancers and uptime
 * checks, so they keep this shape instead of using problem details.
 *
 * Failure reasons are logged, never returned: this endpoint is public.
 */
export const HealthReport = z.object({
  status: z.enum(["ok", "unavailable"]),
  checks: z.record(z.string(), HealthCheckResult),
});
export type HealthReport = z.infer<typeof HealthReport>;
