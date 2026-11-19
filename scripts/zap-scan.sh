#!/usr/bin/env bash
# The ZAP scans of docs/security-review.md, against the production-like
# stack (npm run stack:up), from inside its Docker network.
#
#   bash scripts/zap-scan.sh <output directory> [baseline|signed-in|active|all]
#
# - baseline:  passive rules, traditional spider, no session
# - signed-in: passive rules, AJAX spider (runs the pages' scripts), as an Owner
# - active:    attacks (injection, traversal, XSS, ...), traditional spider, as
#              an Owner. The AJAX spider beside the active scan ran out of
#              memory with the stack on the same machine, so this one uses the
#              traditional spider, with two threads per host.
#
# Reports land in the output directory (JSON and HTML). Only ever point it at
# the local stack.
set -euo pipefail

OUT=$(cd "${1:?output directory}" && pwd)
WHICH=${2:-all}
ZAP=zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af
SITE=https://opspilot.localhost:3443
PROXY=$(docker compose -f docker-compose.prod.yml ps -q proxy)
NETWORK=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$PROXY")
PROXY_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PROXY")
# The scanner reaches the site's names at the proxy, as a browser would.
RUN=(docker run --rm --network "$NETWORK"
  --add-host "opspilot.localhost:$PROXY_IP" --add-host "storage.opspilot.localhost:$PROXY_IP"
  -v "$OUT:/zap/wrk:rw" "$ZAP")
chmod 777 "$OUT"

session_cookie() {
  local jar email
  jar=$(mktemp)
  email="zap-$(date +%s)@example.com"
  curl -sk -o /dev/null -X POST -H "Origin: $SITE" -H 'Content-Type: application/json' \
    -d "{\"name\":\"Zap Owner\",\"email\":\"$email\",\"password\":\"correct horse battery staple\"}" "$SITE/api/v1/auth/sign-up"
  curl -sk -o /dev/null -c "$jar" -X POST -H "Origin: $SITE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"correct horse battery staple\"}" "$SITE/api/v1/auth/sign-in"
  awk '$6 ~ /opspilot_/ {printf "%s=%s; ", $6, $7}' "$jar"
  rm -f "$jar"
}

# Sends the session's cookies with every request the scan makes.
with_session() {
  local cookie
  cookie=$(session_cookie)
  echo "-config replacer.full_list(0).description=session -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Cookie -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=${cookie// /%20}"
}

if [[ $WHICH == baseline || $WHICH == all ]]; then
  echo "== baseline, no session"
  "${RUN[@]}" zap-baseline.py -t "$SITE" -m 3 -I -J baseline.json -r baseline.html
fi
if [[ $WHICH == signed-in || $WHICH == all ]]; then
  echo "== baseline, signed in, AJAX spider"
  "${RUN[@]}" zap-baseline.py -t "$SITE/events" -j -m 4 -I -J baseline-signed-in.json -r baseline-signed-in.html \
    -z "$(with_session)"
fi
if [[ $WHICH == active || $WHICH == all ]]; then
  echo "== active scan, signed in, traditional spider"
  "${RUN[@]}" zap-full-scan.py -t "$SITE/events" -m 3 -T 30 -I -J active.json -r active.html \
    -z "-config scanner.threadPerHost=2 $(with_session)"
fi
