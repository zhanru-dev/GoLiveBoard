/**
 * CI's dependency audit (docs/06, "Dependency audit"): `npm audit` of the
 * production dependencies, judged against audit-allowlist.json.
 *
 *   node scripts/audit.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { judge } from "./audit-policy.mjs";

let output;
try {
  output = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  // npm audit exits non-zero when it finds anything; its report is still
  // on standard output.
  output = error.stdout;
}
const report = JSON.parse(output);
if (report.error !== undefined) {
  process.stderr.write(`npm audit failed: ${JSON.stringify(report.error)}\n`);
  process.exit(1);
}
const allowlist = JSON.parse(
  readFileSync(new URL("../audit-allowlist.json", import.meta.url), "utf8"),
);
const today = new Date().toISOString().slice(0, 10);
const { advisories, problems } = judge(report, allowlist, today);

for (const advisory of advisories) {
  process.stdout.write(
    `${advisory.id} ${advisory.severity}: ${advisory.title} (${[...advisory.packages].join(", ")})\n`,
  );
}
if (problems.length > 0) {
  process.stderr.write(`\nThe audit fails:\n- ${problems.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(
  `Audit passed: ${String(advisories.length)} reported, all allowed in audit-allowlist.json.\n`,
);
