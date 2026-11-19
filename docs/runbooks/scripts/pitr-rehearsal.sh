#!/usr/bin/env bash
# Rehearses a point-in-time restore of PostgreSQL (docs/runbooks/
# restore-database.md), locally, with the stack's PostgreSQL image: WAL is
# archived, a base backup taken, rows written, then deleted by "accident";
# a new server is restored from the backup and the archive to the moment
# before the deletion. RDS does the same with its own backups and WAL.
#
#   bash docs/runbooks/scripts/pitr-rehearsal.sh
#
# Uses its own containers and volumes, and removes them at the end.
set -euo pipefail

IMAGE=postgres:18.6-alpine
RUN=pitr-$$
VOLUMES=("$RUN-data" "$RUN-archive" "$RUN-backup" "$RUN-restored")
cleanup() {
  docker rm -f "$RUN-primary" "$RUN-restored" >/dev/null 2>&1 || true
  docker volume rm "${VOLUMES[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql_in() { docker exec "$1" psql -U postgres -d rehearsal -tAc "$2"; }
wait_ready() {
  for _ in $(seq 1 60); do
    docker exec "$1" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "server $1 did not start" >&2
  return 1
}

for volume in "${VOLUMES[@]}"; do docker volume create "$volume" >/dev/null; done
# The archive is written by the postgres user inside the container.
docker run --rm -v "$RUN-archive:/archive" -v "$RUN-backup:/backup" -v "$RUN-restored:/restored" \
  "$IMAGE" sh -c 'chown postgres:postgres /archive /backup /restored'

echo "1. A primary that archives every WAL segment"
docker run -d --name "$RUN-primary" -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal \
  -v "$RUN-data:/var/lib/postgresql" -v "$RUN-archive:/archive" -v "$RUN-backup:/backup" \
  "$IMAGE" -c wal_level=replica -c archive_mode=on \
  -c "archive_command=test ! -f /archive/%f && cp %p /archive/%f" >/dev/null
wait_ready "$RUN-primary"
sleep 2
psql_in "$RUN-primary" "CREATE TABLE events (id int PRIMARY KEY, title text);
  INSERT INTO events VALUES (1, 'before the backup');" >/dev/null

echo "2. A base backup"
docker exec -u postgres "$RUN-primary" pg_basebackup -D /backup/base -X fetch -c fast >/dev/null

echo "3. More writes after it, then the moment to return to"
psql_in "$RUN-primary" "INSERT INTO events VALUES (2, 'after the backup');" >/dev/null
sleep 2
TARGET=$(psql_in "$RUN-primary" "SELECT now()")
echo "   target: $TARGET"
sleep 2

echo "4. The accident"
psql_in "$RUN-primary" "DELETE FROM events;" >/dev/null
psql_in "$RUN-primary" "SELECT pg_switch_wal();" >/dev/null
sleep 3
echo "   rows left on the primary: $(psql_in "$RUN-primary" "SELECT count(*) FROM events")"

echo "5. A new server from the backup, replaying the archive to the target"
# The image keeps PostgreSQL 18's data in /var/lib/postgresql/18/docker.
DATA=/restored/18/docker
docker run --rm -v "$RUN-backup:/backup" -v "$RUN-restored:/restored" "$IMAGE" sh -c "
  mkdir -p $DATA && cp -a /backup/base/. $DATA/"
docker run --rm -v "$RUN-restored:/restored" "$IMAGE" sh -c "
  touch $DATA/recovery.signal
  cat >> $DATA/postgresql.auto.conf <<CONF
restore_command = 'cp /archive/%f %p'
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'
CONF
  chown -R postgres:postgres /restored"
docker run -d --name "$RUN-restored" -e POSTGRES_PASSWORD=rehearsal \
  -v "$RUN-restored:/var/lib/postgresql" -v "$RUN-archive:/archive" "$IMAGE" >/dev/null
wait_ready "$RUN-restored"
for _ in $(seq 1 30); do
  [ "$(docker exec "$RUN-restored" psql -U postgres -tAc 'SELECT pg_is_in_recovery()')" = "f" ] && break
  sleep 1
done

echo "6. What the restored server holds"
ROWS=$(psql_in "$RUN-restored" "SELECT string_agg(id || ' ' || title, '; ' ORDER BY id) FROM events")
echo "   $ROWS"
if [ "$ROWS" = "1 before the backup; 2 after the backup" ]; then
  echo "PASS: restored to $TARGET, both rows back, the deletion undone"
else
  echo "FAIL: expected both rows" >&2
  exit 1
fi
