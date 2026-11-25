import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * infra/deploy/host-deploy.sh.tftpl, the script SSM runs on the AWS host
 * (docs/06, section 4), rendered as Terraform renders it, against fakes of
 * `aws`, `docker` and `curl`, in a directory standing in for /opt/opspilot.
 */
const TEMPLATE = fileURLToPath(
  new URL("../infra/deploy/host-deploy.sh.tftpl", import.meta.url),
);
const SHA = "c".repeat(40);
const PREVIOUS = "d".repeat(40);

/** As Terraform's templatefile: ${name} filled in, $${ left as ${. */
function render() {
  const values = {
    document_name: "opspilot-test-deploy",
    releases_bucket: "opspilot-test-releases",
    region: "eu-west-2",
    registry: "123456789012.dkr.ecr.eu-west-2.amazonaws.com",
    parameter_path: "/opspilot/test",
  };
  return readFileSync(TEMPLATE, "utf8")
    .replace(/(?<!\$)\$\{([a-z_]+)\}/g, (_, name) => {
      if (!(name in values)) {
        throw new Error(`The template uses an unknown variable: ${name}`);
      }
      return values[name];
    })
    .replaceAll("$${", "${");
}

const FAKE_AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$FAKE_LOG"
case "$1 $2" in
  # The last two arguments are the source and the destination.
  "s3 cp") src="\${@: -2:1}"; dest="\${@: -1}"; printf 'release file from %s\\n' "$src" > "$dest" ;;
  "ssm get-parameters-by-path")
    printf '/opspilot/test/DATABASE_URL\\tpostgres://opspilot:pw@db:5432/opspilot\\n'
    printf '/opspilot/test/JWT_SECRET\\tnot-a-real-secret\\n'
    ;;
  "ecr get-login-password") sleep 1; echo "password" ;;
esac
`;

// Reads the password on stdin for `login`, as the real one does: one that
// exited first would end `aws ecr get-login-password` with SIGPIPE, and the
// script (pipefail) with 141. The fake aws answers late, so a fake that
// does not read fails every time instead of now and then.
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $* API_IMAGE=\${API_IMAGE:-}" >> "$FAKE_LOG"
[[ "$1" == login ]] && cat > /dev/null
if [[ "$1 $2" == "compose up" ]]; then
  echo "docker compose up"
  [[ -n "\${FAIL_UP:-}" ]] && exit 1
fi
exit 0
`;

const FAKE_CURL = `#!/usr/bin/env bash
while (($#)); do [[ $1 == -o ]] && { echo "CA bundle" > "$2"; }; shift; done
`;

function host(action, env = {}, { running } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "host-deploy-test-"));
  const bin = join(dir, "bin");
  const root = join(dir, "opt");
  mkdirSync(bin);
  mkdirSync(join(root, "releases"), { recursive: true });
  for (const [name, script] of [
    ["aws", FAKE_AWS],
    ["docker", FAKE_DOCKER],
    ["curl", FAKE_CURL],
  ]) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  if (running !== undefined) {
    mkdirSync(join(root, "releases", running));
    symlinkSync(join(root, "releases", running), join(root, "current"));
  }
  const script = join(dir, "deploy.sh");
  writeFileSync(script, render());
  const log = join(dir, "log");
  writeFileSync(log, "");
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      OPSPILOT_ROOT: root,
      FAKE_LOG: log,
      ACTION: action,
      SHA,
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    root,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

// Each test runs the script in bash with a dozen fake commands: a second
// or two, more on a busy machine, past Vitest's 5 s default once.
describe("host-deploy.sh", { timeout: 30_000 }, () => {
  it("renders the release's configuration from Parameter Store, readable by root only", () => {
    const run = host("deploy");

    expect(run.status, run.stderr).toBe(0);
    const envFile = join(run.root, "releases", SHA, ".env");
    expect(readFileSync(envFile, "utf8")).toBe(
      [
        "DATABASE_URL=postgres://opspilot:pw@db:5432/opspilot",
        "JWT_SECRET=not-a-real-secret",
        `SENTRY_RELEASE=${SHA}`,
        "",
      ].join("\n"),
    );
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    // The release's files, from the release's own prefix in the bucket.
    expect(
      readFileSync(
        join(run.root, "releases", SHA, "docker-compose.yml"),
        "utf8",
      ),
    ).toBe(
      `release file from s3://opspilot-test-releases/${SHA}/docker-compose.yml\n`,
    );
    expect(
      readFileSync(join(run.root, "releases", SHA, "Caddyfile"), "utf8"),
    ).toBe(`release file from s3://opspilot-test-releases/${SHA}/Caddyfile\n`);
    expect(run.calls).toContain(
      "aws ssm get-parameters-by-path --region eu-west-2 --path /opspilot/test --recursive --with-decryption --query Parameters[].[Name,Value] --output text",
    );
  });

  it("names the running release before starting the new one, and points current at it once healthy", () => {
    const run = host("deploy", {}, { running: PREVIOUS });

    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.split("\n");
    expect(lines.indexOf(`previous=${PREVIOUS}`)).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(`previous=${PREVIOUS}`)).toBeLessThan(
      lines.indexOf("docker compose up"),
    );
    expect(lines).toContain(`deployed=${SHA}`);
    expect(basename(readlinkSync(join(run.root, "current")))).toBe(SHA);
    expect(run.calls).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^docker compose up -d --wait .*API_IMAGE=.*/opspilot-api:${SHA}$`,
        ),
      ),
    );
  });

  it("leaves current on the running release when the new one never becomes healthy", () => {
    const run = host("deploy", { FAIL_UP: "1" }, { running: PREVIOUS });

    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain(`previous=${PREVIOUS}`);
    expect(run.stdout).not.toContain("deployed=");
    expect(basename(readlinkSync(join(run.root, "current")))).toBe(PREVIOUS);
  });

  it("migrates in a one-off container of the release's image, and starts nothing", () => {
    const run = host("migrate");

    expect(run.status, run.stderr).toBe(0);
    expect(run.calls).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^docker compose run --rm migrate API_IMAGE=.*/opspilot-api:${SHA}$`,
        ),
      ),
    );
    expect(run.calls.some((call) => call.startsWith("docker compose up"))).toBe(
      false,
    );
    expect(existsSync(join(run.root, "current"))).toBe(false);
  });

  it("refuses anything but a full commit SHA before it fetches anything", () => {
    const run = host("deploy", { SHA: "latest" });

    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
  });

  it("says which release is running", () => {
    const run = host("current", { SHA: "" }, { running: PREVIOUS });

    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`current=${PREVIOUS}`);
  });
});
