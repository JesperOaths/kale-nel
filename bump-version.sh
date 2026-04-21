#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
[[ -n "$VERSION" ]] || { echo "VERSION is empty" >&2; exit 1; }
find "$ROOT_DIR" -type f \( -name '*.html' -o -name '*.js' \) -print0 | while IFS= read -r -d '' file; do
  perl -0pi -e "s/window\.GEJAST_PAGE_VERSION='v\d+'/window.GEJAST_PAGE_VERSION='v${VERSION}'/g; s/(gejast-config\.js\?v)\d+/${1}${VERSION}/g; s/(gejast-home-gate\.js\?v)\d+/${1}${VERSION}/g;" "$file"
done
perl -0pi -e "s/VERSION:'v\d+'/VERSION:'v${VERSION}'/" "$ROOT_DIR/gejast-config.js"
echo "Bumped frontend references to v${VERSION}"
