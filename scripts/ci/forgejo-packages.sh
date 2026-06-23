#!/usr/bin/env bash
# Publish build outputs to Forgejo Packages and link them to a repository.
#
# Requires: FORGEJO_USERNAME, FORGEJO_TOKEN
# Optional: FORGEJO_HOST (default git.atlastechsolutions.co.uk)
#
# Usage:
#   forgejo-packages.sh pypi <owner> <repo_name> [dist_dir]
#   forgejo-packages.sh generic <owner> <package_name> <version> <repo_name> <file>...
#   forgejo-packages.sh link <owner> <type> <package_name> <repo_name>
set -euo pipefail

FORGEJO_HOST="${FORGEJO_HOST:-git.atlastechsolutions.co.uk}"
API="https://${FORGEJO_HOST}/api/v1"

require_auth() {
  if [[ -z "${FORGEJO_USERNAME:-}" || -z "${FORGEJO_TOKEN:-}" ]]; then
    echo "FORGEJO_USERNAME and FORGEJO_TOKEN are required to publish Forgejo packages" >&2
    exit 1
  fi
}

urlencode() {
  python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}

cmd_link() {
  local owner=$1 type=$2 name=$3 repo=$4
  local enc
  enc=$(urlencode "$name")
  local code body
  body=$(mktemp)
  code=$(curl -sS -o "$body" -w '%{http_code}' -X POST \
    -H "Authorization: token ${FORGEJO_TOKEN}" \
    "${API}/packages/${owner}/${type}/${enc}/-/link/${repo}" || echo "000")
  if [[ "$code" == "200" || "$code" == "204" ]]; then
    echo "Linked ${type}/${name} -> ${owner}/${repo}"
    return 0
  fi
  echo "WARN: could not auto-link ${type}/${name} to ${repo} (HTTP ${code}). Link manually under org Packages -> Settings." >&2
  [[ -s "$body" ]] && cat "$body" >&2 || true
  return 0
}

cmd_pypi() {
  require_auth
  local owner=$1 repo_name=$2 dist_dir=${3:-dist}
  if [[ ! -d "$dist_dir" ]] || ! compgen -G "${dist_dir}/*" >/dev/null; then
    echo "No files in ${dist_dir}" >&2
    exit 1
  fi
  local pkg_name
  pkg_name=$(ls "${dist_dir}"/*.whl 2>/dev/null | head -1 | sed -E 's/.*\/([^-]+)-[^-]+-.*\.whl/\1/')
  if [[ -z "$pkg_name" ]]; then
    pkg_name=$(ls "${dist_dir}"/*.tar.gz 2>/dev/null | head -1 | sed -E 's/.*\/([^-]+)-[^-]+\.tar\.gz/\1/')
  fi
  echo "Publishing PyPI package ${pkg_name} to ${owner}..."
  twine upload \
    --repository-url "${API}/packages/${owner}/pypi" \
    -u "${FORGEJO_USERNAME}" -p "${FORGEJO_TOKEN}" \
    --skip-existing \
    "${dist_dir}"/*
  if [[ -n "$pkg_name" ]]; then
    cmd_link "$owner" "pypi" "$pkg_name" "$repo_name"
  fi
}

cmd_generic() {
  require_auth
  local owner=$1 package_name=$2 version=$3 repo_name=$4
  shift 4
  if (($# == 0)); then
    echo "No files to upload" >&2
    exit 1
  fi
  local enc_pkg enc_ver
  enc_pkg=$(urlencode "$package_name")
  enc_ver=$(urlencode "$version")
  for file in "$@"; do
    [[ -f "$file" ]] || continue
    local fname
    fname=$(basename "$file")
    local enc_file
    enc_file=$(urlencode "$fname")
    echo "Uploading generic ${package_name}/${version}/${fname}..."
    curl -sS -f -X PUT \
      --user "${FORGEJO_USERNAME}:${FORGEJO_TOKEN}" \
      --upload-file "$file" \
      "${API}/packages/${owner}/generic/${enc_pkg}/${enc_ver}/${enc_file}"
  done
  cmd_link "$owner" "generic" "$package_name" "$repo_name"
}

main() {
  local cmd=${1:-}
  shift || true
  case "$cmd" in
    pypi) cmd_pypi "$@" ;;
    generic) cmd_generic "$@" ;;
    link) require_auth; cmd_link "$@" ;;
    *)
      echo "Usage: forgejo-packages.sh {pypi|generic|link} ..." >&2
      exit 1
      ;;
  esac
}

main "$@"
