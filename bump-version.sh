#!/usr/bin/env bash
set -euo pipefail
VERSION="$(tr -dc '0-9' < VERSION)"
find . -maxdepth 2 -name '*.html' -print0 | while IFS= read -r -d '' file; do
  perl -0pi -e "s/gejast-config\.js\?v\d+/gejast-config.js?v${VERSION}/g; s/gejast-home-gate\.js\?v\d+/gejast-home-gate.js?v${VERSION}/g; s/window\.GEJAST_PAGE_VERSION='v\d+'/window.GEJAST_PAGE_VERSION='v${VERSION}'/g" "$file"
done
