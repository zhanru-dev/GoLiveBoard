#!/usr/bin/env bash
# Releases one commit to the AWS demo environment (docs/06, section 4); run
# by .github/workflows/deploy.yml once its images are in ECR and its files
# are in the releases bucket:
#
#   1. migrate:  prisma migrate deploy on the host (expand-and-contract, so
#                the running release keeps working);
#   2. deploy:   start the release; the host answers with the SHA it ran
#                before ("previous=");
#   3. ready:    wait for /api/v1/health/ready on the public URL;
#   4. smoke:    the smoke tests against the public URL;
#   5. on any failure after step 2 began: deploy "previous" again and wait
#      until it is ready, then fail, so the run is red and the site is up.
#
# Settings (the workflow passes them):
#   SHA             the commit to release (40 hex digits)
#   INSTANCE_ID     the host
#   DEPLOY_DOCUMENT the SSM document that runs infra/deploy/host-deploy.sh
#   SITE_URL        e.g. https://opspilot.example.com
#   SMOKE_COMMAND   the smoke tests, e.g. "npx playwright test ..."
#   READY_TIMEOUT   seconds to wait for readiness (default 180)
#   POLL_SECONDS    seconds between polls (default 5)
set -uo pipefail

: "${SHA:?}" "${INSTANCE_ID:?}" "${DEPLOY_DOCUMENT:?}" "${SITE_URL:?}" "${SMOKE_COMMAND:?}"
READY_TIMEOUT=${READY_TIMEOUT:-180}
POLL_SECONDS=${POLL_SECONDS:-5}

if [[ ! $SHA =~ ^[0-9a-f]{40}$ ]]; then
  echo "SHA must be a full commit SHA, not '$SHA'" >&2
  exit 2
fi

log() { echo "[release] $*" >&2; }

# Runs the deploy document on the host and waits for it; prints its output,
# also when it failed: a deploy says "previous=" before it starts the
# release, and a rollback needs it most when the release never came up.
host() {
  local action=$1 sha=${2:-} id status
  id=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name "$DEPLOY_DOCUMENT" \
    --parameters "Action=$action,Sha=$sha" --query Command.CommandId --output text) || return 1
  while true; do
    sleep "$POLL_SECONDS"
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
      --query Status --output text 2>/dev/null) || continue
    case $status in
      Pending | InProgress | Delayed) ;;
      Success)
        aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
          --query StandardOutputContent --output text
        return 0
        ;;
      *)
        log "host: $action $sha ended $status"
        aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
          --query StandardOutputContent --output text || true
        aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
          --query StandardErrorContent --output text >&2 || true
        return 1
        ;;
    esac
  done
}

ready() {
  local deadline=$((SECONDS + READY_TIMEOUT))
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null --max-time 10 "$SITE_URL/api/v1/health/ready"; then
      return 0
    fi
    sleep "$POLL_SECONDS"
  done
  log "not ready after ${READY_TIMEOUT}s"
  return 1
}

previous=""

rollback() {
  if [[ -z $previous || $previous == "$SHA" ]]; then
    log "nothing to roll back to (first release, or the same commit)"
    return 1
  fi
  log "rolling back to $previous"
  host deploy "$previous" >/dev/null && ready && log "rolled back to $previous"
}

log "migrating for $SHA"
if ! host migrate "$SHA" >/dev/null; then
  # Nothing changed for users: the running release is untouched.
  log "migration failed; the running release stays"
  exit 1
fi

log "deploying $SHA"
output=$(host deploy "$SHA")
deployed=$?
previous=$(printf '%s\n' "$output" | sed -n 's/^previous=\([0-9a-f]\{40\}\)$/\1/p' | tail -n 1)
log "previous release: ${previous:-none}"

if ((deployed != 0)); then
  log "the release did not become healthy"
  rollback
  exit 1
fi

if ! ready; then
  rollback
  exit 1
fi

log "smoke tests against $SITE_URL"
if ! bash -c "$SMOKE_COMMAND"; then
  log "smoke tests failed"
  rollback
  exit 1
fi

log "released $SHA"
