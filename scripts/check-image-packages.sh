#!/usr/bin/env bash
# Fails if a runtime image has an Alpine package with a newer version in
# the Alpine repositories: a security fix the image could have and does not.
# Vulnerability scanners learn of a fix later than Alpine ships it (Trivy
# passed images that ECR's scan flagged), so this asks Alpine directly.
#
#   scripts/check-image-packages.sh goliveboard-api:local goliveboard-web:local
set -euo pipefail

[[ $# -gt 0 ]] || { echo "usage: $0 IMAGE..." >&2; exit 2; }

status=0
for image in "$@"; do
  # `apk version -l '<'` prints a header line, then one line per package
  # whose installed version is lower than the repositories'.
  outdated="$(docker run --rm --user root --entrypoint sh "$image" -c \
    'apk update --quiet >/dev/null && apk version -l "<"' | tail -n +2)"
  if [[ -n "$outdated" ]]; then
    echo "$image has OS packages with a newer version available:" >&2
    echo "$outdated" >&2
    status=1
  else
    echo "$image: every OS package is current"
  fi
done
exit "$status"
