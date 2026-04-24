#!/usr/bin/env bash
set -euo pipefail
VERSION="$(tr -dc '0-9' < VERSION)"
if [[ -z "$VERSION" ]]; then echo "VERSION file missing/empty" >&2; exit 1; fi
python3 - <<'INNER_PY'
from pathlib import Path
import re
version = Path('VERSION').read_text(encoding='utf-8').strip()
tag = f'v{version}'
for path in Path('.').glob('*.html'):
    text = path.read_text(encoding='utf-8', errors='ignore')
    text = re.sub(r"window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v\d+[a-z]?['\"]", f"window.GEJAST_PAGE_VERSION='{tag}'", text)
    text = re.sub(r"(\./[A-Za-z0-9_.\/-]+\.(?:js|css|json))\?v\d+[a-z]?", lambda m: f"{m.group(1)}?v{version}", text)
    text = re.sub(r"\?__bust=v\d+[a-z]?", f"?__bust=v{version}", text)
    text = re.sub(r"var\s+want\s*=\s*['\"]v\d+[a-z]?['\"]", f"var want='v{version}'", text)
    text = re.sub(r"v\d+[a-z]?\s*[·.-]\s*Made by Bruis", f"v{version} · Made by Bruis", text, flags=re.I)
    path.write_text(text, encoding='utf-8')
config = Path('gejast-config.js')
if config.exists():
    text = config.read_text(encoding='utf-8', errors='ignore')
    text = re.sub(r"VERSION\s*:\s*'v\d+[a-z]?'", f"VERSION:'v{version}'", text, count=1)
    config.write_text(text, encoding='utf-8')
INNER_PY
