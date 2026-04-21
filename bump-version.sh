#!/usr/bin/env bash
set -e
# sync root html helper cache-busts from VERSIONuo pipefail
ROOT="${1:-.}"
VERSION_FILE="$ROOT/VERSION"
if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Missing VERSION file at $VERSION_FILE" >&2
  exit 1
fi
VERSION="$(tr -dc '0-9' < "$VERSION_FILE")"
if [[ -z "$VERSION" ]]; then
  echo "VERSION file must contain digits" >&2
  exit 1
fi
find "$ROOT" -maxdepth 1 -type f -name '*.html' -print0 | while IFS= read -r -d '' file; do
  perl -0pi -e "s/window\.GEJAST_PAGE_VERSION='v\d+'/window.GEJAST_PAGE_VERSION='v${VERSION}'/g; s/(\.(?:js|css)\?v)\d+/${1}${VERSION}/g" "$file"
done
perl -0pi -e "s/VERSION:'v\d+'/VERSION:'v${VERSION}'/g" "$ROOT/gejast-config.js"
echo "Bumped HTML asset versions and gejast-config.js to v${VERSION}."
