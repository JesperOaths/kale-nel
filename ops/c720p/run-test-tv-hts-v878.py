#!/usr/bin/env python3
import subprocess,urllib.request
from pathlib import Path
url="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/test-tv-hts-v874.py"
p=Path("/tmp/test-tv-hts-v874.py")
with urllib.request.urlopen(url,timeout=30) as r:
    p.write_bytes(r.read())
subprocess.run(["python3",str(p)],check=True)
