/**
 * Runs the NFR-4 load test against the production-like stack (one API
 * instance): seeds a live event and its attendees, runs k6 inside the
 * stack's network, and keeps k6's summary in load/out/.
 *
 *   npm run stack:up
 *   npm run load:nfr4
 *
 * ATTENDEES (default 500), SEND_EVERY_MS (default 25000, so 20 messages a
 * second for 500), READS_PER_SECOND (default: one page load per attendee a minute), RAMP_S (60) and STEADY_S
 * (180) change the load.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const attendees = process.env.ATTENDEES ?? "500";
const K6_IMAGE =
  "grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8";

const sql = execFileSync("node", ["load/seed.mjs", attendees], {
  cwd: root,
  encoding: "utf8",
});
execFileSync(
  "docker",
  [
    "compose",
    "--file",
    "docker-compose.prod.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "--quiet",
    "--set=ON_ERROR_STOP=1",
    "--username=opspilot",
    "opspilot",
  ],
  { cwd: root, input: sql, stdio: ["pipe", "ignore", "inherit"] },
);
process.stdout.write(`Seeded ${attendees} attendees.\n`);

const env = ["SEND_EVERY_MS", "READS_PER_SECOND", "RAMP_S", "STEADY_S"].flatMap(
  (name) =>
    process.env[name] === undefined
      ? []
      : ["--env", `${name}=${process.env[name]}`],
);
execFileSync(
  "docker",
  [
    "run",
    "--rm",
    // As this user, so k6 may write its summary into load/out.
    ...(process.getuid === undefined
      ? []
      : [
          "--user",
          `${String(process.getuid())}:${String(process.getgid?.() ?? 0)}`,
        ]),
    "--network",
    "opspilot-stack_default",
    // Enough open files for 500 sockets and their reads.
    "--ulimit",
    "nofile=65536:65536",
    "--volume",
    `${root}load:/load`,
    K6_IMAGE,
    "run",
    "--summary-export",
    "/load/out/summary.json",
    ...env,
    "/load/k6/nfr4.js",
  ],
  { cwd: root, stdio: "inherit" },
);
