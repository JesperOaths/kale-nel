#!/usr/bin/env bash
set -euo pipefail
VERSION="$(tr -dc '0-9' < VERSION)"
find . -maxdepth 1 -name '*.html' -print0 | while IFS= read -r -d '' file; do perl -0pi -e "s/window\.GEJAST_PAGE_VERSION='v\d+'/window.GEJAST_PAGE_VERSION='v${VERSION}'/g; s/gejast-config\.js\?v\d+/gejast-config.js?v${VERSION}/g; s/gejast-account-scope\.js\?v\d+/gejast-account-scope.js?v${VERSION}/g" "$file"; done
