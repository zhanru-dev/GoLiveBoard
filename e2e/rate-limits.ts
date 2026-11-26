import { execFileSync } from "node:child_process";

import { target } from "./target.js";

/**
 * Forgets every rate-limit window, or those of one rule (its name, as in
 * RATE_LIMITS, may end in `*`). All browser traffic reaches the API from
 * the proxy's one address, so the suite as a whole would otherwise exhaust
 * the per-address limits (sign-ups, ten an hour) that each test stays well
 * within. Only rate-limit keys are removed, through the Valkey of the Compose
 * project the tests run against.
 */
export function resetRateLimits(rule = "*"): void {
  execFileSync(
    "docker",
    [
      "compose",
      "--file",
      target.composeFile,
      "exec",
      "-T",
      "valkey",
      "valkey-cli",
      "EVAL",
      "for _, key in ipairs(redis.call('KEYS', ARGV[1])) do redis.call('DEL', key) end",
      "0",
      `goliveboard:rate:${rule}`,
    ],
    { stdio: "ignore" },
  );
}
