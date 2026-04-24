#!/usr/bin/env bash
set -euo pipefail
VERSION="$(tr -dc '0-9' < VERSION)"
if [ -z "$VERSION" ]; then echo "VERSION is empty" >&2; exit 1; fi
python3 - <<'PYINNER'
from pathlib import Path
import re
version = Path('VERSION').read_text(encoding='utf-8').strip()
tag = f'v{version}'
runtime_ext = {'.html','.js','.css'}
for path in Path('.').rglob('*'):
    if not path.is_file() or path.suffix.lower() not in runtime_ext:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    old = text
    text = re.sub(r"window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v\d+[a-z]?['\"]", f"window.GEJAST_PAGE_VERSION='{tag}'", text)
    text = re.sub(r"VERSION\s*:\s*['\"]v\d+[a-z]?['\"]", f"VERSION:'{tag}'", text, count=1) if path.name == 'gejast-config.js' else text
    text = re.sub(r"(\./[^'\"?#>\s]+\.(?:js|css))\?v\d+[a-z]?", lambda m: f"{m.group(1)}?v{version}", text)
    text = re.sub(r"v\d+[a-z]?\s*·\s*Made by Bruis", f"{tag} · Made by Bruis", text, flags=re.I)
    if text != old:
        path.write_text(text, encoding='utf-8')
PYINNER
