#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(tr -d '[:space:]' < "$repo_root/VERSION")"
if [[ -z "$version" ]]; then
  echo "VERSION file is empty" >&2
  exit 1
fi
cd "$repo_root"
python - <<'PY2'
from pathlib import Path
import re
repo = Path('.')
version = Path('VERSION').read_text(encoding='utf-8').strip()
version_tag = f'v{version}'
for path in repo.glob('*.html'):
    text = path.read_text(encoding='utf-8', errors='ignore')
    text = re.sub(r'window\.GEJAST_PAGE_VERSION\s*=\s*["\']v[^"\']+["\']', f"window.GEJAST_PAGE_VERSION='{version_tag}'", text)
    text = re.sub(r'(\./[^"\'?#>]+\.js)\?v[0-9]+[a-z]?', lambda m: f"{m.group(1)}?v{version}", text)
    path.write_text(text, encoding='utf-8')
config = Path('gejast-config.js')
if config.exists():
    text = config.read_text(encoding='utf-8', errors='ignore')
    text = re.sub(r"VERSION:'v[0-9]+'", f"VERSION:'{version_tag}'", text, count=1)
    config.write_text(text, encoding='utf-8')
PY2
