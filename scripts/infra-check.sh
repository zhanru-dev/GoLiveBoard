#!/usr/bin/env bash
# Checks the Terraform without an AWS account (docs/06, section 5), each
# tool in a container pinned by digest, so nothing is installed locally:
#
#   bash scripts/infra-check.sh [fmt|validate|test|lint|scan|all]
#
# - fmt:      terraform fmt, as a check
# - validate: terraform init (no backend) and validate, per configuration
# - test:     terraform test with mocked providers: each module's tests/,
#             and the demo environment's
# - lint:     tflint with the AWS ruleset (the root .tflint.hcl, named
#             explicitly: --recursive alone ignores it below the root)
# - scan:     checkov; every skipped check carries its reason in the code
#
# Every check runs; the script fails if any of them did.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WHICH=${1:-all}
TERRAFORM=hashicorp/terraform@sha256:a5d5a5a892c98f60fcbfa81eac2a40fc19e7b3fa7719bccae10ff6111d22524a
TFLINT=ghcr.io/terraform-linters/tflint@sha256:65b9944a9274c4989492c1d79998c2801664bf8a55fddb4bd3a9e6d73a006ddc
CHECKOV=bridgecrew/checkov@sha256:bfe9d70bb7f044aba49bd99675813445f106dee6072da583f51008cb667f3a63
CONFIGURATIONS=(bootstrap environments/demo)
failed=()

terraform() {
  docker run --rm -v "$ROOT/infra:/infra" -w /infra/terraform \
    -e TF_IN_AUTOMATION=1 -e TF_PLUGIN_CACHE_DIR=/infra/terraform/.terraform/plugin-cache \
    "$TERRAFORM" "$@"
}

# Runs one check, and remembers it if it fails.
check() {
  local name=$1
  shift
  echo "== $name"
  "$@" || failed+=("$name")
}

wanted() { [[ $WHICH == "$1" || $WHICH == all ]]; }

mkdir -p "$ROOT/infra/terraform/.terraform/plugin-cache"

if wanted fmt; then
  check "terraform fmt" terraform fmt -recursive -check -diff
fi

modules=()
for tests in "$ROOT"/infra/terraform/modules/*/tests; do
  modules+=("modules/$(basename "$(dirname "$tests")")")
done

if wanted validate || wanted test; then
  for configuration in "${CONFIGURATIONS[@]}" "${modules[@]}"; do
    terraform -chdir="$configuration" init -backend=false -input=false -no-color >/dev/null ||
      failed+=("terraform init: $configuration")
  done
fi

if wanted validate; then
  for configuration in "${CONFIGURATIONS[@]}"; do
    check "terraform validate: $configuration" terraform -chdir="$configuration" validate -no-color
  done
fi

if wanted test; then
  for configuration in "${modules[@]}" environments/demo; do
    check "terraform test: $configuration" terraform -chdir="$configuration" test -no-color
  done
fi

if wanted lint; then
  check "tflint" docker run --rm -v "$ROOT/infra/terraform:/data" -w /data \
    -e TFLINT_PLUGIN_DIR=/data/.terraform/tflint-plugins --entrypoint sh "$TFLINT" -c \
    'tflint --init --config /data/.tflint.hcl >/dev/null &&
     tflint --recursive --config /data/.tflint.hcl --format compact'
fi

if wanted scan; then
  check "checkov" docker run --rm -v "$ROOT/infra:/infra" -w /infra "$CHECKOV" \
    --directory terraform --framework terraform --quiet --compact \
    --skip-path .terraform --download-external-modules false
fi

if ((${#failed[@]} > 0)); then
  printf 'Failed: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "All infrastructure checks passed."
