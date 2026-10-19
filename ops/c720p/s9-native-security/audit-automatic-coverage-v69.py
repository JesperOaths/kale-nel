#!/usr/bin/env python3
"""Report non-identifying readiness counts; no writes."""
import json
from pathlib import Path
from urllib.request import urlopen

def call(port,route):
 try:
  with urlopen('http://127.0.0.1:'+str(port)+route,timeout=12) as response:
   return json.loads(response.read(6000000))
 except Exception:
  return {}

def main():
 proposal=Path('/home/jespern/c720p-home-hub/state/s9-auto-person-face-proposals-v1.json')
 data=json.loads(proposal.read_text()) if proposal.is_file() and not proposal.is_symlink() else {}
 automatic=call(8795,'/new/api/automatic-person')
 camera=call(18808,'/status')
 result={'auto_status':automatic.get('status'),'auto_count':len(automatic.get('items',[])),
  'proposal_count':len(data.get('suggestions',[])),
  'capture_mode':camera.get('mode'),'preroll_version':camera.get('preroll_version'),
  'buffer_ready':camera.get('continuous_4k_ready'),
  'buffered_ms':camera.get('continuous_4k_buffered_ms'),
  'tail_ms':camera.get('person_post_motion_hold_ms'),
  'camera_ok':camera.get('ok') is True,'writes':0}
 print('AUTO_CAPTURE_V69 '+json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
