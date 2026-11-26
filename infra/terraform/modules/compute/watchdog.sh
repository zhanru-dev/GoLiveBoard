#!/bin/bash
# Restarts the application's containers that are stuck: run every 30
# seconds on the AWS host by a systemd timer (installed at first boot,
# user-data.sh.tftpl, beside this file).
#
# Docker restarts a container whose process exits (restart: unless-stopped),
# but not one whose process hangs: its health check fails, and nothing acts
# on it. An orchestrator (ECS, Kubernetes) would replace it; on one host
# with Compose, this does, with three limits:
# - The API's health check is readiness, which also fails while PostgreSQL
#   or Valkey is down, and a restart would not bring them back. The API is
#   restarted only when its liveness fails too (the process itself is
#   stuck), as Kubernetes separates liveness from readiness.
# - At most three restarts per container per hour. Beyond that a restart is
#   not helping: the container is left for a person, whom the alerts call.
# - Never during a deploy (host-deploy.sh holds the lock), which waits for
#   the new containers' health itself and rolls back if it never comes.
set -euo pipefail

# GOLIVEBOARD_ROOT is for the script's tests only.
ROOT="${GOLIVEBOARD_ROOT:-/opt/goliveboard}"
PROJECT=goliveboard
MAX_RESTARTS_PER_HOUR=3
STATE="$ROOT/watchdog"
install -d -m 0750 "$STATE"

log() { logger -t goliveboard-watchdog "$*"; }

exec 9>"$ROOT/deploy.lock"
if ! flock -n 9; then
  exit 0 # a deploy is running
fi

now=$(date +%s)
docker ps --filter "label=com.docker.compose.project=$PROJECT" \
  --filter health=unhealthy --format '{{.Names}}' |
  while read -r name; do
    [[ -n "$name" ]] || continue
    service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$name")

    if [[ "$service" == api ]] &&
      docker exec "$name" node -e "fetch('http://127.0.0.1:4301/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
      continue # alive, but a dependency is down: not ours to fix
    fi

    # Restarts in the last hour, one timestamp per line.
    history="$STATE/$service"
    touch "$history"
    recent=$(awk -v since=$((now - 3600)) '$1 >= since' "$history")
    if (($(grep -c . <<<"$recent" || true) >= MAX_RESTARTS_PER_HOUR)); then
      log "$service is unhealthy; already restarted $MAX_RESTARTS_PER_HOUR times this hour, leaving it to the alerts"
      continue
    fi

    log "$service is unhealthy; restarting $name"
    docker restart --timeout 30 "$name" >/dev/null
    { [[ -n "$recent" ]] && echo "$recent"; echo "$now"; } >"$history"
  done
