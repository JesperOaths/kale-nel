#!/usr/bin/env python3
"""Run bounded archive-only S9 cleanup during cool idle camera windows."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

PURGE=Path('/home/jespern/c720p-home-hub/bin/s9-purge-quarantined-empty-clips.py')
def main():
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=9) as response:
  status=json.load(response)
 if (not status.get('ok') or status.get('mode')!='watching'
     or not status.get('garden_person_gate_ready')
     or float(status.get('temperature_c') or 100)>=37.5):
  print('S9_ARCHIVE_PRUNE_DEFERRED_CAMERA_ACTIVE_OR_HOT')
  return
 if not PURGE.is_file() or PURGE.stat().st_size<3000:
  raise RuntimeError('verified_purge_implementation_missing')
 subprocess.run([sys.executable,str(PURGE),'--apply','--max-clips','25'],
                timeout=200,check=True)
if __name__=='__main__':main()
