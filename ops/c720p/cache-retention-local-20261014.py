#!/usr/bin/env python3
"""Local-only browser cache guard; never touches user data."""
import json
import shutil
from pathlib import Path
HOME=Path('/home/jespern')
if __name__=='__main__':
 print(json.dumps({'free_bytes':shutil.disk_usage('/').free,'status':'diagnostic_only'}))
