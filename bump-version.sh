#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/VERSION"

if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "Missing VERSION file at $VERSION_FILE" >&2
  exit 1
fi

RAW_VERSION="$(tr -dc '0-9' < "${VERSION_FILE}")"
if [[ -z "${RAW_VERSION}" ]]; then
  echo "VERSION file does not contain a numeric version" >&2
  exit 1
fi

rewrite_html_file() {
  local file="$1"
  python3 - "$file" "$RAW_VERSION" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
version = sys.argv[2]
text = path.read_text(encoding='utf-8', errors='ignore')

text = re.sub(r"(window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v?)\d+(['\"])", rf"\g<1>{version}\2", text)
text = re.sub(r"([?&]v)\d+(?=[^0-9]|$)", rf"\g<1>{version}", text)
path.write_text(text, encoding='utf-8')
PY
}

export -f rewrite_html_file

find "${ROOT}" -maxdepth 1 -type f -name '*.html' -print0 | while IFS= read -r -d '' file; do
  rewrite_html_file "$file"
done

if [[ -d "${ROOT}/familie" ]]; then
  find "${ROOT}/familie" -maxdepth 1 -type f -name '*.html' -print0 | while IFS= read -r -d '' file; do
    rewrite_html_file "$file"
  done
fi

python3 - "${ROOT}/gejast-config.js" "$RAW_VERSION" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
version = sys.argv[2]
text = path.read_text(encoding='utf-8', errors='ignore')
text = re.sub(r"VERSION:'v\d+'", f"VERSION:'v{version}'", text, count=1)
path.write_text(text, encoding='utf-8')
PY

echo "Bumped HTML/script query versions and gejast-config.js to v$RAW_VERSION"

# v624: keep homepage scripts aligned
