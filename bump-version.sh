#!/usr/bin/env bash
set -euo pipefail
VERSION="$(tr -dc '0-9' < VERSION)"
if [[ -z "$VERSION" ]]; then
  echo "VERSION file is empty or has no digits" >&2
  exit 1
fi
TAG="v${VERSION}"
find . -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -print0 | while IFS= read -r -d '' file; do
  perl -0pi -e "s/window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v\d+[a-z]?['\"]/window.GEJAST_PAGE_VERSION='${TAG}'/g; s/VERSION:'v\d+[a-z]?'/VERSION:'${TAG}'/g; s/(\.\/[A-Za-z0-9_.-]+\.(?:js|css|html))\?v\d+[a-z]?/\${1}?v${VERSION}/g; s/v\d+[a-z]?\s*·\s*Made by Bruis/${TAG} · Made by Bruis/g; s/var want='v\d+[a-z]?'/var want='${TAG}'/g" "$file"
done
