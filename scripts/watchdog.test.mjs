import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * infra/terraform/modules/compute/watchdog.sh, the AWS host's restarter of
 * hung containers, against fakes of `docker`, `flock` and `logger`.
 */
const SCRIPT = fileURLToPath(
  new URL("../infra/terraform/modules/compute/watchdog.sh", import.meta.url),
);

// UNHEALTHY: the unhealthy containers' services; API_LIVE: whether the
// API's process answers its liveness check.
const FAKE_DOCKER = `#!/usr/bin/env bash
case "$1" in
  ps) for service in \${UNHEALTHY:-}; do echo "goliveboard-$service-1"; done ;;
  inspect) name="\${@: -1}"; service="\${name#goliveboard-}"; echo "\${service%-1}" ;;
  exec) echo "docker exec \${2}" >> "$FAKE_LOG"; [[ "\${API_LIVE:-yes}" == yes ]] ;;
  restart) echo "docker restart \${@: -1}" >> "$FAKE_LOG" ;;
esac
`;
const FAKE_FLOCK = `#!/usr/bin/env bash
[[ -z "\${DEPLOYING:-}" ]]
`;
const FAKE_LOGGER = `#!/usr/bin/env bash
shift 2
echo "log $*" >> "$FAKE_LOG"
`;

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), "watchdog-test-"));
  const bin = join(dir, "bin");
  const root = join(dir, "opt");
  mkdirSync(bin);
  mkdirSync(root);
  for (const [name, script] of [
    ["docker", FAKE_DOCKER],
    ["flock", FAKE_FLOCK],
    ["logger", FAKE_LOGGER],
  ]) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  const log = join(dir, "log");
  writeFileSync(log, "");
  const run = (env = {}) => {
    const result = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GOLIVEBOARD_ROOT: root,
        FAKE_LOG: log,
        ...env,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    writeFileSync(log, "");
    return calls;
  };
  return { run, root };
}

describe("watchdog.sh", { timeout: 30_000 }, () => {
  it("restarts an unhealthy container, and leaves the healthy alone", () => {
    const { run } = setUp();

    expect(run({ UNHEALTHY: "web" })).toEqual([
      "log web is unhealthy; restarting goliveboard-web-1",
      "docker restart goliveboard-web-1",
    ]);
    expect(run()).toEqual([]);
  });

  it("restarts the API only when its process is stuck, not while a dependency is down", () => {
    const { run } = setUp();

    // Readiness fails (PostgreSQL is down, say), liveness answers.
    expect(run({ UNHEALTHY: "api", API_LIVE: "yes" })).toEqual([
      "docker exec goliveboard-api-1",
    ]);
    // Liveness fails too: the process hangs.
    expect(run({ UNHEALTHY: "api", API_LIVE: "no" })).toEqual([
      "docker exec goliveboard-api-1",
      "log api is unhealthy; restarting goliveboard-api-1",
      "docker restart goliveboard-api-1",
    ]);
  });

  it("restarts a container three times an hour at most, then leaves it to the alerts", () => {
    const { run, root } = setUp();
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(run({ UNHEALTHY: "web" })).toContain(
        "docker restart goliveboard-web-1",
      );
    }

    expect(run({ UNHEALTHY: "web" })).toEqual([
      "log web is unhealthy; already restarted 3 times this hour, leaving it to the alerts",
    ]);

    // An hour later the count starts again.
    const hourAgo = Math.floor(Date.now() / 1000) - 3700;
    writeFileSync(
      join(root, "watchdog", "web"),
      `${hourAgo}\n${hourAgo}\n${hourAgo}\n`,
    );
    expect(run({ UNHEALTHY: "web" })).toContain(
      "docker restart goliveboard-web-1",
    );
  });

  it("does nothing while a deploy holds the lock", () => {
    const { run } = setUp();

    expect(run({ UNHEALTHY: "web api", DEPLOYING: "yes" })).toEqual([]);
  });
});
