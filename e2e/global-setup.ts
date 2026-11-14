import { execFileSync } from "node:child_process";

import { target } from "./target.js";

/**
 * Starts every run with fresh rate-limit windows. All browser traffic reaches
 * the API from the proxy's one address, so a few local runs within an hour
 * would otherwise exhaust the per-address sign-up limit. Only rate-limit keys
 * are removed, through the Valkey of the Compose project the tests run
 * against.
 */
export default function globalSetup(): void {
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
      "for _, key in ipairs(redis.call('KEYS', 'opspilot:rate:*')) do redis.call('DEL', key) end",
      "0",
    ],
    { stdio: "inherit" },
  );
}
