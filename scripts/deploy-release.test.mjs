import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * scripts/deploy/release.sh, the deploy pipeline's release step (docs/06,
 * section 4), against fakes of `aws` and `curl` that record what the script
 * asks the host to do: the order of migrate, deploy and rollback is the
 * whole point of the script.
 */
const RELEASE = fileURLToPath(new URL("./deploy/release.sh", import.meta.url));
const SHA = "a".repeat(40);
const PREVIOUS = "b".repeat(40);

/**
 * A fake `aws ssm`: send-command records "<action> <sha>"; the command
 * succeeds unless FAIL names it ("migrate", or "deploy:<sha>"). A deploy
 * prints "previous=$PREVIOUS" (when set) and makes its SHA the one running.
 */
const FAKE_AWS = String.raw`#!/usr/bin/env bash
set -u
state=$FAKE_STATE
args="$*"
arg() { local key=$1; shift; while (($#)); do [[ $1 == "$key" ]] && { echo "$2"; return; }; shift; done; }
case $args in
  "ssm send-command"*)
    params=$(arg --parameters "$@")
    action=$(sed -n 's/^Action=\([a-z]*\),Sha=\(.*\)$/\1/p' <<<"$params")
    sha=$(sed -n 's/^Action=\([a-z]*\),Sha=\(.*\)$/\2/p' <<<"$params")
    echo "$action $sha" >> "$state/calls"
    n=$(($(wc -l < "$state/calls")))
    echo "$action $sha" > "$state/command-$n"
    echo "command-$n"
    ;;
  "ssm get-command-invocation"*)
    id=$(arg --command-id "$@")
    read -r action sha < "$state/$id"
    query=$(arg --query "$@")
    failing=" \${FAIL:-} "
    if [[ $failing == *" $action "* || $failing == *" $action:$sha "* ]]; then status=Failed; else status=Success; fi
    case $query in
      Status) echo "$status" ;;
      StandardOutputContent)
        if [[ $action == deploy ]]; then
          [[ -n \${PREVIOUS:-} ]] && echo "previous=$PREVIOUS"
          echo "$sha" > "$state/running"
          echo "deployed=$sha"
        fi
        ;;
      StandardErrorContent) echo "fake failure" ;;
    esac
    ;;
  *) echo "unexpected aws $args" >&2; exit 64 ;;
esac
`;

/** A fake `curl`: ready unless the running SHA is listed in NOT_READY. */
const FAKE_CURL = String.raw`#!/usr/bin/env bash
running=$(cat "$FAKE_STATE/running" 2>/dev/null)
[[ " \${NOT_READY:-} " == *" $running "* ]] && exit 22
exit 0
`;

/** String.raw keeps "\${": bash needs a plain "${". */
const shell = (script) => script.replaceAll("\\${", "${");

function release(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  writeFileSync(join(dir, "aws"), shell(FAKE_AWS));
  writeFileSync(join(dir, "curl"), shell(FAKE_CURL));
  chmodSync(join(dir, "aws"), 0o755);
  chmodSync(join(dir, "curl"), 0o755);
  writeFileSync(join(dir, "calls"), "");
  const result = spawnSync("bash", [RELEASE], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_STATE: dir,
      SHA,
      INSTANCE_ID: "i-0123456789abcdef0",
      DEPLOY_DOCUMENT: "opspilot-demo-deploy",
      SITE_URL: "https://opspilot.example.com",
      SMOKE_COMMAND: "exit 0",
      READY_TIMEOUT: "1",
      POLL_SECONDS: "0",
      PREVIOUS,
      ...env,
    },
  });
  const calls = readFileSync(join(dir, "calls"), "utf8")
    .split("\n")
    .filter((line) => line !== "");
  return { status: result.status, calls, log: result.stderr };
}

// Each test runs the script in bash with fake commands; see host-deploy.test.mjs.
describe("release.sh", { timeout: 30_000 }, () => {
  it("migrates, then deploys, and stops there when the release is healthy", () => {
    const run = release();

    expect(run.calls).toEqual([`migrate ${SHA}`, `deploy ${SHA}`]);
    expect(run.status, run.log).toBe(0);
  });

  it("deploys the previous release again when the smoke tests fail, and fails the run", () => {
    const run = release({ SMOKE_COMMAND: "exit 1" });

    expect(run.calls).toEqual([
      `migrate ${SHA}`,
      `deploy ${SHA}`,
      `deploy ${PREVIOUS}`,
    ]);
    expect(run.status).toBe(1);
    expect(run.log).toContain(`rolled back to ${PREVIOUS}`);
  });

  it("rolls back when the release never becomes healthy on the host", () => {
    const run = release({ FAIL: `deploy:${SHA}` });

    expect(run.calls).toEqual([
      `migrate ${SHA}`,
      `deploy ${SHA}`,
      `deploy ${PREVIOUS}`,
    ]);
    expect(run.status).toBe(1);
  });

  it("rolls back when the public URL never says it is ready", () => {
    const run = release({ NOT_READY: SHA });

    expect(run.calls).toEqual([
      `migrate ${SHA}`,
      `deploy ${SHA}`,
      `deploy ${PREVIOUS}`,
    ]);
    expect(run.status).toBe(1);
  });

  it("deploys nothing when the migration fails: the running release stays", () => {
    const run = release({ FAIL: "migrate" });

    expect(run.calls).toEqual([`migrate ${SHA}`]);
    expect(run.status).toBe(1);
  });

  it("fails without a rollback on the first release, when there is nothing to go back to", () => {
    const run = release({ PREVIOUS: "", SMOKE_COMMAND: "exit 1" });

    expect(run.calls).toEqual([`migrate ${SHA}`, `deploy ${SHA}`]);
    expect(run.status).toBe(1);
    expect(run.log).toContain("nothing to roll back to");
  });

  it("refuses anything but a full commit SHA before touching the host", () => {
    const run = release({ SHA: "main; rm -rf /" });

    expect(run.calls).toEqual([]);
    expect(run.status).toBe(2);
  });
});
