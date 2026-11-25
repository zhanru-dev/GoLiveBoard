import { resetRateLimits } from "./rate-limits.js";

/** Starts every run with fresh rate-limit windows (see resetRateLimits). */
export default function globalSetup(): void {
  resetRateLimits();
}
